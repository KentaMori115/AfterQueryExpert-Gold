"""Cardinality estimation.

The estimates here are deliberately crude — fixed selectivity factors rather
than histograms — but they are consistent, which is what matters for the
decisions that use them: whether a join should hash its left or right input,
and what a plan dump reports as the expected row count.

An estimate of ``None`` means "unknown", and every rule that consumes estimates
must treat unknown as "do not reorder".
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from typing import Any, Dict, Optional

from ..expr.ast import BinaryOp, Expression, Literal
from ..expr.simplify import split_conjunction
from .logical import (
    Aggregate,
    Distinct,
    Except,
    Filter,
    Intersect,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
    Union,
)

__all__ = ["ColumnStatistics", "Statistics", "estimate", "DEFAULT_SELECTIVITY"]

# Selectivity assumed for a predicate whose shape we cannot reason about.
DEFAULT_SELECTIVITY = 0.5
EQUALITY_SELECTIVITY = 0.1
RANGE_SELECTIVITY = 0.3
NULL_CHECK_SELECTIVITY = 0.9
# Fraction of rows assumed to survive duplicate removal.
DISTINCT_FACTOR = 0.7


@dataclass(frozen=True)
class ColumnStatistics:
    """What is known about one column."""

    null_count: Optional[int] = None
    distinct_count: Optional[int] = None
    min_value: Any = None
    max_value: Any = None

    def describe(self) -> str:
        """Render the statistics for a plan dump."""
        parts = []
        if self.distinct_count is not None:
            parts.append(f"distinct={self.distinct_count}")
        if self.null_count is not None:
            parts.append(f"nulls={self.null_count}")
        if self.min_value is not None or self.max_value is not None:
            parts.append(f"range=[{self.min_value}, {self.max_value}]")
        return " ".join(parts) or "unknown"


@dataclass(frozen=True)
class Statistics:
    """Row count and per-column statistics for a plan node."""

    num_rows: Optional[int] = None
    columns: Dict[str, ColumnStatistics] = dataclass_field(default_factory=dict)

    @property
    def is_known(self) -> bool:
        """True when a row count is available."""
        return self.num_rows is not None

    def column(self, name: str) -> ColumnStatistics:
        """Return the statistics for one column, empty when unknown."""
        return self.columns.get(name.lower(), ColumnStatistics())

    def scaled(self, factor: float) -> "Statistics":
        """Return a copy with the row count multiplied by ``factor``."""
        if self.num_rows is None:
            return Statistics(None, dict(self.columns))
        scaled = max(int(round(self.num_rows * factor)), 0)
        return Statistics(scaled, dict(self.columns))

    def with_rows(self, num_rows: Optional[int]) -> "Statistics":
        """Return a copy with a different row count."""
        return Statistics(num_rows, dict(self.columns))

    def describe(self) -> str:
        """Render the row count for a plan dump."""
        return "rows=unknown" if self.num_rows is None else f"rows={self.num_rows}"


def estimate(plan: LogicalPlan) -> Statistics:
    """Estimate the statistics of a plan node's output."""
    if isinstance(plan, Scan):
        return _scan_statistics(plan)
    if isinstance(plan, Filter):
        child = estimate(plan.input)
        return child.scaled(selectivity(plan.predicate))
    if isinstance(plan, Project):
        return estimate(plan.input)
    if isinstance(plan, Sort):
        return estimate(plan.input)
    if isinstance(plan, Limit):
        child = estimate(plan.input)
        if child.num_rows is None:
            return child.with_rows(plan.count)
        remaining = max(child.num_rows - plan.offset, 0)
        if plan.count is None:
            return child.with_rows(remaining)
        return child.with_rows(min(remaining, plan.count))
    if isinstance(plan, Distinct):
        return estimate(plan.input).scaled(DISTINCT_FACTOR)
    if isinstance(plan, Aggregate):
        child = estimate(plan.input)
        if plan.is_global:
            return child.with_rows(1)
        return child.scaled(0.3)
    if isinstance(plan, Union):
        left = estimate(plan.left)
        right = estimate(plan.right)
        if left.num_rows is None or right.num_rows is None:
            return Statistics(None)
        total = left.num_rows + right.num_rows
        return Statistics(total if plan.all else max(int(total * DISTINCT_FACTOR), 1))
    if isinstance(plan, (Intersect, Except)):
        left = estimate(plan.left)
        right = estimate(plan.right)
        if left.num_rows is None or right.num_rows is None:
            return Statistics(None)
        # Neither operation can emit more rows than its left input, and an
        # intersection is capped by its right input as well. ``ALL`` reports
        # that bound; the plain spelling scales it the way a union's is, but
        # floored at zero because either operation may keep nothing at all.
        bound = left.num_rows
        if isinstance(plan, Intersect):
            bound = min(bound, right.num_rows)
        return Statistics(bound if plan.all else max(int(bound * DISTINCT_FACTOR), 0))
    if isinstance(plan, Join):
        return _join_statistics(plan)
    return Statistics(None)


def selectivity(predicate: Optional[Expression]) -> float:
    """Estimate the fraction of rows a predicate keeps."""
    if predicate is None:
        return 1.0
    factor = 1.0
    for term in split_conjunction(predicate):
        factor *= _term_selectivity(term)
    return max(min(factor, 1.0), 0.0)


def _term_selectivity(term: Expression) -> float:
    """Estimate one conjunct's selectivity from its shape."""
    from ..expr.ast import IsNull

    if isinstance(term, Literal):
        if term.value is True:
            return 1.0
        if term.value is False or term.value is None:
            return 0.0
    if isinstance(term, IsNull):
        return 1.0 - NULL_CHECK_SELECTIVITY if not term.negated else NULL_CHECK_SELECTIVITY
    if isinstance(term, BinaryOp):
        if term.operator == "=":
            return EQUALITY_SELECTIVITY
        if term.operator == "!=":
            return 1.0 - EQUALITY_SELECTIVITY
        if term.operator in ("<", "<=", ">", ">="):
            return RANGE_SELECTIVITY
        if term.operator == "or":
            left = _term_selectivity(term.left)
            right = _term_selectivity(term.right)
            return min(left + right, 1.0)
        if term.operator in ("like", "not like"):
            return RANGE_SELECTIVITY
    return DEFAULT_SELECTIVITY


def _scan_statistics(plan: Scan) -> Statistics:
    """Ask the data source for its statistics, applying pushed-down filters."""
    provider = getattr(plan.source, "statistics", None)
    base = provider() if callable(provider) else Statistics(None)
    if not isinstance(base, Statistics):
        base = Statistics(None)
    if plan.filters:
        factor = 1.0
        for item in plan.filters:
            factor *= selectivity(item)
        return base.scaled(factor)
    return base


def _join_statistics(plan: Join) -> Statistics:
    """Estimate join output size from its inputs and join type."""
    left = estimate(plan.left)
    right = estimate(plan.right)
    if left.num_rows is None or right.num_rows is None:
        return Statistics(None)
    if plan.how == "cross":
        return Statistics(left.num_rows * right.num_rows)
    keys = plan.equi_keys()
    if not keys:
        product = left.num_rows * right.num_rows
        return Statistics(max(int(product * selectivity(plan.condition)), 0))
    # With equi-keys, assume the larger side drives the output.
    estimated = max(left.num_rows, right.num_rows)
    if plan.how == "inner":
        estimated = min(estimated, left.num_rows * right.num_rows)
    elif plan.how == "left":
        estimated = max(estimated, left.num_rows)
    elif plan.how == "right":
        estimated = max(estimated, right.num_rows)
    else:
        estimated = left.num_rows + right.num_rows
    return Statistics(estimated)
