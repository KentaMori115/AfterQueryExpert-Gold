"""A fluent builder for logical plans.

The SQL compiler produces plans node by node, but tests and embedded callers
often want to describe a pipeline directly. The builder validates each step
against the schema built so far, so a mistake is reported where it is written
rather than at execution time.

    >>> plan = (
    ...     PlanBuilder.from_source(source)
    ...     .filter("amount > 100")
    ...     .aggregate(["region"], ["sum(amount) AS total"])
    ...     .sort("total DESC")
    ...     .limit(10)
    ...     .build()
    ... )
"""

from __future__ import annotations

from typing import Any, Iterable, List, Optional, Sequence, Union as TypingUnion

from ..errors import PlanningError
from ..expr.ast import Expression, contains_aggregate
from ..expr.parser import ExpressionParser, parse_expression
from ..expr.resolver import ExpressionResolver
from ..expr.tokenizer import TokenType, tokenize
from ..types.schema import Schema
from .logical import (
    Aggregate,
    Distinct,
    Filter,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
    SortKey,
    Except,
    Intersect,
    Union,
)

__all__ = ["PlanBuilder", "parse_sort_key"]

ExpressionLike = TypingUnion[str, Expression]


def _as_expression(value: ExpressionLike) -> Expression:
    """Accept either an expression object or its SQL text.

    Text may carry a trailing ``AS name``, so a projection can be written the
    way it would appear in a query rather than by wrapping it in an
    :class:`~veldt.expr.ast.Alias` by hand.

    Raises:
        PlanningError: If the text has tokens left over after the expression.
    """
    if isinstance(value, Expression):
        return value
    parser = ExpressionParser(tokenize(value), value)
    expression = parser.parse_aliased_expression()
    if not parser.at_end():
        raise PlanningError(f"unexpected text in expression: {value!r}")
    return expression


def parse_sort_key(text: str) -> SortKey:
    """Parse one ``ORDER BY`` term including direction and null placement.

    Accepts ``expr``, ``expr DESC``, ``expr ASC NULLS LAST`` and so on.
    """
    parser = ExpressionParser(tokenize(text), text)
    expression = parser.parse_expression()
    ascending = True
    nulls_first: Optional[bool] = None
    if parser.match_keyword("desc"):
        ascending = False
    else:
        parser.match_keyword("asc")
    if parser.match_keyword("nulls"):
        if parser.match_keyword("first"):
            nulls_first = True
        elif parser.match_keyword("last"):
            nulls_first = False
        else:
            raise PlanningError("NULLS must be followed by FIRST or LAST")
    if not parser.at_end():
        raise PlanningError(f"unexpected text in sort key: {text!r}")
    return SortKey(expression, ascending, nulls_first)


class PlanBuilder:
    """Builds a logical plan one operation at a time."""

    def __init__(self, plan: LogicalPlan, resolver: Optional[ExpressionResolver] = None) -> None:
        self._plan = plan
        self._resolver = resolver or ExpressionResolver()

    # ------------------------------------------------------------------
    # Entry points
    # ------------------------------------------------------------------
    @classmethod
    def from_source(cls, source: Any, alias: Optional[str] = None) -> "PlanBuilder":
        """Start a plan from a data source."""
        return cls(Scan(source, alias))

    @classmethod
    def from_plan(cls, plan: LogicalPlan) -> "PlanBuilder":
        """Continue building on top of an existing plan."""
        return cls(plan)

    # ------------------------------------------------------------------
    # Inspection
    # ------------------------------------------------------------------
    @property
    def schema(self) -> Schema:
        """The schema produced by the plan built so far."""
        return self._plan.schema

    @property
    def plan(self) -> LogicalPlan:
        """The plan built so far."""
        return self._plan

    def build(self) -> LogicalPlan:
        """Return the finished plan."""
        return self._plan

    # ------------------------------------------------------------------
    # Operations
    # ------------------------------------------------------------------
    def filter(self, predicate: ExpressionLike) -> "PlanBuilder":
        """Add a ``WHERE``-style filter.

        Raises:
            PlanningError: If the predicate references unknown columns or
                contains an aggregate.
        """
        expression = _as_expression(predicate)
        if contains_aggregate(expression):
            raise PlanningError("filter predicates must not contain aggregates")
        self._resolver.validate(expression, self._plan.schema)
        return PlanBuilder(Filter(self._plan, expression), self._resolver)

    def project(self, expressions: Sequence[ExpressionLike]) -> "PlanBuilder":
        """Add a projection."""
        resolved = [_as_expression(item) for item in expressions]
        for expression in resolved:
            self._resolver.validate(expression, self._plan.schema)
        return PlanBuilder(Project(self._plan, tuple(resolved)), self._resolver)

    def select(self, *names: str) -> "PlanBuilder":
        """Project a plain list of column names."""
        return self.project(list(names))

    def aggregate(
        self,
        group_by: Sequence[ExpressionLike] = (),
        aggregates: Sequence[ExpressionLike] = (),
    ) -> "PlanBuilder":
        """Add a grouped or global aggregation."""
        groups = [_as_expression(item) for item in group_by]
        aggs = [_as_expression(item) for item in aggregates]
        for expression in groups + aggs:
            self._resolver.validate(expression, self._plan.schema)
        return PlanBuilder(
            Aggregate(self._plan, tuple(groups), tuple(aggs)), self._resolver
        )

    def sort(self, *keys: TypingUnion[str, SortKey]) -> "PlanBuilder":
        """Add an ordering.

        Raises:
            PlanningError: If no keys are supplied.
        """
        resolved: List[SortKey] = []
        for key in keys:
            item = key if isinstance(key, SortKey) else parse_sort_key(key)
            self._resolver.validate(item.expression, self._plan.schema)
            resolved.append(item)
        if not resolved:
            raise PlanningError("sort requires at least one key")
        return PlanBuilder(Sort(self._plan, tuple(resolved)), self._resolver)

    def limit(self, count: Optional[int], offset: int = 0) -> "PlanBuilder":
        """Add a row limit and optional offset."""
        return PlanBuilder(Limit(self._plan, count, offset), self._resolver)

    def distinct(self) -> "PlanBuilder":
        """Remove duplicate rows."""
        return PlanBuilder(Distinct(self._plan), self._resolver)

    def join(
        self,
        right: TypingUnion["PlanBuilder", LogicalPlan],
        condition: Optional[ExpressionLike] = None,
        how: str = "inner",
    ) -> "PlanBuilder":
        """Join with another plan."""
        other = right.build() if isinstance(right, PlanBuilder) else right
        expression = _as_expression(condition) if condition is not None else None
        node = Join(self._plan, other, expression, how)
        if expression is not None:
            self._resolver.validate(expression, node.schema)
        return PlanBuilder(node, self._resolver)

    def union(
        self, other: TypingUnion["PlanBuilder", LogicalPlan], all_rows: bool = False
    ) -> "PlanBuilder":
        """Concatenate with another plan."""
        right = other.build() if isinstance(other, PlanBuilder) else other
        return PlanBuilder(Union(self._plan, right, all_rows), self._resolver)

    def intersect(
        self, other: TypingUnion["PlanBuilder", LogicalPlan], all_rows: bool = False
    ) -> "PlanBuilder":
        """Keep only the rows the other plan also produced."""
        right = other.build() if isinstance(other, PlanBuilder) else other
        return PlanBuilder(Intersect(self._plan, right, all_rows), self._resolver)

    def except_(
        self, other: TypingUnion["PlanBuilder", LogicalPlan], all_rows: bool = False
    ) -> "PlanBuilder":
        """Keep only the rows the other plan did not produce."""
        right = other.build() if isinstance(other, PlanBuilder) else other
        return PlanBuilder(Except(self._plan, right, all_rows), self._resolver)

    def __repr__(self) -> str:
        return f"PlanBuilder({self._plan.node_name})"
