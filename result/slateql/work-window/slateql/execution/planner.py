"""Lowers a logical plan into a tree of physical operators.

The planner makes exactly one interesting decision: which join algorithm to
use.  Everything else is a mechanical one-to-one mapping, which keeps the
optimizer -- not the planner -- responsible for plan quality.
"""

from __future__ import annotations

from typing import Optional, Sequence

from ..errors import PlanningError
from ..plan import expressions as X
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
)
from ..sql.ast_nodes import JoinKind
from ..storage.catalog import Catalog
from ..types.schema import Schema
from .operators import (
    AggregateOperator,
    DistinctOperator,
    EmptyScan,
    FilterOperator,
    HashJoinOperator,
    LimitOperator,
    NestedLoopJoinOperator,
    Operator,
    ProjectOperator,
    SingleRowScan,
    SortOperator,
    TableScan,
    UnionOperator,
)

__all__ = ["PhysicalPlanner", "plan_to_operator", "extract_equi_keys"]


class PhysicalPlanner:
    """Builds an operator tree for a logical plan."""

    def __init__(self, catalog: Catalog, *, prefer_hash_join: bool = True) -> None:
        self.catalog = catalog
        self.prefer_hash_join = prefer_hash_join

    def build(self, plan: LogicalPlan) -> Operator:
        """Lower ``plan`` into operators."""

        if isinstance(plan, Scan):
            return self._build_scan(plan)
        if isinstance(plan, OneRow):
            return SingleRowScan()
        if isinstance(plan, EmptyRelation):
            return EmptyScan(plan.schema)
        if isinstance(plan, Filter):
            return FilterOperator(self.build(plan.input), plan.predicate)
        if isinstance(plan, Project):
            return ProjectOperator(self.build(plan.input), plan.projections)
        if isinstance(plan, Aggregate):
            return AggregateOperator(
                self.build(plan.input), plan.group_by, plan.aggregates
            )
        if isinstance(plan, Sort):
            return SortOperator(self.build(plan.input), plan.keys)
        if isinstance(plan, Limit):
            return LimitOperator(self.build(plan.input), plan.count, plan.offset)
        if isinstance(plan, Distinct):
            return DistinctOperator(self.build(plan.input))
        if isinstance(plan, Join):
            return self._build_join(plan)
        if isinstance(plan, SetOp):
            return UnionOperator(
                self.build(plan.left),
                self.build(plan.right),
                plan.schema,
                all_rows=plan.all_rows,
            )
        raise PlanningError(f"cannot lower plan node {type(plan).__name__}")

    def _build_scan(self, plan: Scan) -> Operator:
        table = self.catalog.get(plan.table)
        return TableScan(
            table,
            plan.schema,
            projection=plan.projection,
            filters=plan.pushed_filters,
        )

    def _build_join(self, plan: Join) -> Operator:
        left = self.build(plan.left)
        right = self.build(plan.right)
        if plan.kind is JoinKind.CROSS or plan.condition is None:
            return NestedLoopJoinOperator(plan.kind, left, right, None)
        if self.prefer_hash_join:
            keys = extract_equi_keys(plan.condition, left.schema, right.schema)
            if keys is not None:
                left_keys, right_keys, residual = keys
                return HashJoinOperator(
                    plan.kind, left, right, left_keys, right_keys, residual
                )
        return NestedLoopJoinOperator(plan.kind, left, right, plan.condition)


def extract_equi_keys(
    condition: X.Expr, left: Schema, right: Schema
) -> Optional[tuple[list[int], list[int], Optional[X.Expr]]]:
    """Split a join condition into equality keys plus a residual predicate.

    Returns ``None`` when no conjunct is a usable equality between one left
    column and one right column, in which case the caller should fall back to
    a nested-loop join.
    """

    left_keys: list[int] = []
    right_keys: list[int] = []
    residual: list[X.Expr] = []

    for conjunct in X.conjuncts(condition):
        pair = _as_equi_pair(conjunct, left, right)
        if pair is None:
            residual.append(conjunct)
            continue
        left_index, right_index = pair
        left_keys.append(left_index)
        right_keys.append(right_index)

    if not left_keys:
        return None
    return left_keys, right_keys, X.combine_and(residual)


def _as_equi_pair(
    conjunct: X.Expr, left: Schema, right: Schema
) -> Optional[tuple[int, int]]:
    """Recognise ``left.col = right.col`` in either operand order."""

    if not isinstance(conjunct, X.BinaryExpr) or conjunct.op != "=":
        return None
    first, second = conjunct.left, conjunct.right
    if not isinstance(first, X.Column) or not isinstance(second, X.Column):
        return None
    forward = _resolve_pair(first, second, left, right)
    if forward is not None:
        return forward
    reversed_pair = _resolve_pair(second, first, left, right)
    return reversed_pair


def _resolve_pair(
    left_side: X.Column, right_side: X.Column, left: Schema, right: Schema
) -> Optional[tuple[int, int]]:
    left_index = left.try_index_of(left_side.name, left_side.qualifier)
    right_index = right.try_index_of(right_side.name, right_side.qualifier)
    if left_index is None or right_index is None:
        return None
    return left_index, right_index


def plan_to_operator(plan: LogicalPlan, catalog: Catalog) -> Operator:
    """Convenience wrapper around :class:`PhysicalPlanner`."""

    return PhysicalPlanner(catalog).build(plan)


def describe_operator_tree(root: Operator, indent: str = "") -> list[str]:
    """Render an operator tree as EXPLAIN-style lines."""

    lines = [f"{indent}{root.describe()}"]
    children: Sequence[Operator] = root.children()
    for index, child in enumerate(children):
        last = index == len(children) - 1
        connector = "`- " if last else "|- "
        nested = describe_operator_tree(child, indent + ("   " if last else "|  "))
        lines.append(indent + connector + nested[0].lstrip())
        lines.extend(nested[1:])
    return lines
