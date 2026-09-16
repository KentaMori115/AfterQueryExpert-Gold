"""A simple cost model.

Cost is expressed in arbitrary units proportional to the number of rows an
operator touches.  It is used to compare two shapes of the same query, never
to predict wall-clock time.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..plan.logical import (
    Aggregate,
    Distinct,
    Filter,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    SetOp,
    Sort,
)
from ..sql.ast_nodes import JoinKind
from .rule import RuleContext
from .stats import estimate_cardinality

__all__ = ["PlanCost", "estimate_cost", "compare_costs"]

_SCAN_COST = 1.0
_FILTER_COST = 0.2
_PROJECT_COST = 0.2
_SORT_COST = 2.0
_HASH_BUILD_COST = 1.5
_NESTED_LOOP_COST = 3.0
_AGGREGATE_COST = 1.2
_DISTINCT_COST = 1.0


@dataclass(frozen=True)
class PlanCost:
    """The estimated cost and cardinality of a plan."""

    rows: int
    cost: float

    def describe(self) -> str:
        return f"rows={self.rows} cost={self.cost:.1f}"

    def __lt__(self, other: "PlanCost") -> bool:
        return self.cost < other.cost


def estimate_cost(plan: LogicalPlan, context: RuleContext) -> PlanCost:
    """Estimate the total cost of running ``plan``."""

    rows = estimate_cardinality(plan, context)
    cost = _node_cost(plan, context)
    for child in plan.children():
        cost += estimate_cost(child, context).cost
    return PlanCost(rows=rows, cost=cost)


def _node_cost(plan: LogicalPlan, context: RuleContext) -> float:
    if isinstance(plan, Scan):
        return estimate_cardinality(plan, context) * _SCAN_COST
    if isinstance(plan, Filter):
        return estimate_cardinality(plan.input, context) * _FILTER_COST
    if isinstance(plan, Project):
        return estimate_cardinality(plan.input, context) * _PROJECT_COST
    if isinstance(plan, Sort):
        rows = max(estimate_cardinality(plan.input, context), 1)
        return rows * _SORT_COST
    if isinstance(plan, Distinct):
        return estimate_cardinality(plan.input, context) * _DISTINCT_COST
    if isinstance(plan, Aggregate):
        return estimate_cardinality(plan.input, context) * _AGGREGATE_COST
    if isinstance(plan, Limit):
        return 0.0
    if isinstance(plan, SetOp):
        left = estimate_cardinality(plan.left, context)
        right = estimate_cardinality(plan.right, context)
        return (left + right) * (_DISTINCT_COST if not plan.all_rows else 0.2)
    if isinstance(plan, Join):
        return _join_cost(plan, context)
    return 0.0


def _join_cost(plan: Join, context: RuleContext) -> float:
    left = estimate_cardinality(plan.left, context)
    right = estimate_cardinality(plan.right, context)
    if plan.kind is JoinKind.CROSS or plan.condition is None:
        return left * right * _NESTED_LOOP_COST
    return right * _HASH_BUILD_COST + left


def compare_costs(left: PlanCost, right: PlanCost) -> int:
    """Three-way comparison used by rules choosing between alternatives."""

    if left.cost < right.cost:
        return -1
    if right.cost < left.cost:
        return 1
    return 0
