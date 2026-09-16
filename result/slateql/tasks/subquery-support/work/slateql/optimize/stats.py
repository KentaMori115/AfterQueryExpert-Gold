"""Cardinality estimation over logical plans.

The estimates are deliberately crude -- fixed selectivity factors rather than
histograms -- but they are consistent, which is what a rule comparing two
alternatives actually needs.
"""

from __future__ import annotations

from ..plan.expressions import BinaryExpr, Expr, InList, IsNull, LikeMatch, Literal
from ..plan.logical import (
    Aggregate,
    Distinct,
    EmptyRelation,
    Filter,
    Join,
    Limit,
    LogicalPlan,
    OneRow,
    Project,
    Scan,
    SetOp,
    Sort,
    SubqueryAlias,
)
from ..sql.ast_nodes import JoinKind
from .rule import RuleContext

__all__ = ["estimate_cardinality", "estimate_selectivity", "DEFAULT_ROWS"]

DEFAULT_ROWS = 1_000

_EQUALITY_SELECTIVITY = 0.1
_RANGE_SELECTIVITY = 0.3
_LIKE_SELECTIVITY = 0.25
_IS_NULL_SELECTIVITY = 0.05
_DEFAULT_SELECTIVITY = 0.5
_DISTINCT_RATIO = 0.7
_GROUP_RATIO = 0.3


def estimate_selectivity(predicate: Expr) -> float:
    """Fraction of rows a predicate is expected to keep, in ``[0, 1]``."""

    if isinstance(predicate, Literal):
        if predicate.value is True:
            return 1.0
        if predicate.value is False or predicate.value is None:
            return 0.0
        return _DEFAULT_SELECTIVITY
    if isinstance(predicate, BinaryExpr):
        if predicate.op == "AND":
            return estimate_selectivity(predicate.left) * estimate_selectivity(
                predicate.right
            )
        if predicate.op == "OR":
            left = estimate_selectivity(predicate.left)
            right = estimate_selectivity(predicate.right)
            return min(1.0, left + right - left * right)
        if predicate.op == "=":
            return _EQUALITY_SELECTIVITY
        if predicate.op == "<>":
            return 1.0 - _EQUALITY_SELECTIVITY
        if predicate.op in ("<", "<=", ">", ">="):
            return _RANGE_SELECTIVITY
    if isinstance(predicate, InList):
        base = min(1.0, _EQUALITY_SELECTIVITY * max(len(predicate.items), 1))
        return 1.0 - base if predicate.negated else base
    if isinstance(predicate, IsNull):
        return (
            1.0 - _IS_NULL_SELECTIVITY if predicate.negated else _IS_NULL_SELECTIVITY
        )
    if isinstance(predicate, LikeMatch):
        return 1.0 - _LIKE_SELECTIVITY if predicate.negated else _LIKE_SELECTIVITY
    return _DEFAULT_SELECTIVITY


def estimate_cardinality(plan: LogicalPlan, context: RuleContext) -> int:
    """Estimate how many rows ``plan`` produces."""

    if isinstance(plan, Scan):
        rows = context.table_rows(plan.table)
        estimate = DEFAULT_ROWS if rows is None else rows
        for predicate in plan.pushed_filters:
            estimate = int(estimate * estimate_selectivity(predicate))
        return max(estimate, 1)
    if isinstance(plan, OneRow):
        return 1
    if isinstance(plan, EmptyRelation):
        return 0
    if isinstance(plan, Filter):
        base = estimate_cardinality(plan.input, context)
        return max(int(base * estimate_selectivity(plan.predicate)), 1)
    if isinstance(plan, (Project, SubqueryAlias)):
        return estimate_cardinality(plan.input, context)
    if isinstance(plan, Sort):
        return estimate_cardinality(plan.input, context)
    if isinstance(plan, Distinct):
        return max(int(estimate_cardinality(plan.input, context) * _DISTINCT_RATIO), 1)
    if isinstance(plan, Aggregate):
        base = estimate_cardinality(plan.input, context)
        if plan.is_global:
            return 1
        return max(int(base * _GROUP_RATIO), 1)
    if isinstance(plan, Limit):
        base = estimate_cardinality(plan.input, context)
        if plan.count is None:
            return max(base - plan.offset, 0)
        return max(min(plan.count, max(base - plan.offset, 0)), 0)
    if isinstance(plan, Join):
        return _estimate_join(plan, context)
    if isinstance(plan, SetOp):
        left = estimate_cardinality(plan.left, context)
        right = estimate_cardinality(plan.right, context)
        total = left + right
        return total if plan.all_rows else max(int(total * _DISTINCT_RATIO), 1)
    return DEFAULT_ROWS


def _estimate_join(plan: Join, context: RuleContext) -> int:
    left = estimate_cardinality(plan.left, context)
    right = estimate_cardinality(plan.right, context)
    if plan.kind is JoinKind.CROSS or plan.condition is None:
        return max(left * right, 1)
    selectivity = estimate_selectivity(plan.condition)
    matched = max(int(left * right * selectivity), 1)
    if plan.kind is JoinKind.LEFT:
        return max(matched, left)
    if plan.kind is JoinKind.RIGHT:
        return max(matched, right)
    if plan.kind is JoinKind.FULL:
        return max(matched, left, right)
    return matched
