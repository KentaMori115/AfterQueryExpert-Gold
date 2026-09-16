"""Translation from logical plans to operator trees.

The physical planner is where the few genuine implementation choices are made:
which join algorithm to use, and whether a scan can hand its filters to the
source. Everything else is a one-to-one mapping from logical node to operator.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from ..errors import PlanningError
from ..plan.logical import (
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
from ..types.schema import Schema
from .context import ExecutionContext
from .operators.aggregate import HashAggregateOperator
from .operators.base import Operator
from .operators.distinct import DistinctOperator
from .operators.filter import FilterOperator
from .operators.join import HashJoinOperator, NestedLoopJoinOperator
from .operators.limit import LimitOperator
from .operators.project import ProjectOperator
from .operators.scan import ScanOperator
from .operators.setop import ExceptOperator, IntersectOperator
from .operators.sort import SortOperator
from .operators.union import UnionOperator

__all__ = ["PhysicalPlanner", "create_physical_plan"]


class PhysicalPlanner:
    """Builds an operator tree from a logical plan."""

    def __init__(self, context: Optional[ExecutionContext] = None) -> None:
        self.context = context or ExecutionContext()

    def create(self, plan: LogicalPlan) -> Operator:
        """Translate ``plan`` into an executable operator tree.

        Raises:
            PlanningError: If the plan contains a node the planner does not
                know how to execute.
        """
        if isinstance(plan, Scan):
            return self._scan(plan)
        if isinstance(plan, Filter):
            return FilterOperator(self.create(plan.input), plan.predicate)
        if isinstance(plan, Project):
            return ProjectOperator(self.create(plan.input), plan.projections, plan.schema)
        if isinstance(plan, Aggregate):
            return HashAggregateOperator(
                self.create(plan.input), plan.group_by, plan.aggregates, plan.schema
            )
        if isinstance(plan, Sort):
            return SortOperator(self.create(plan.input), plan.keys)
        if isinstance(plan, Limit):
            return LimitOperator(self.create(plan.input), plan.count, plan.offset)
        if isinstance(plan, Distinct):
            return DistinctOperator(self.create(plan.input))
        if isinstance(plan, Union):
            return UnionOperator(
                self.create(plan.left), self.create(plan.right), plan.schema
            )
        if isinstance(plan, Intersect):
            return IntersectOperator(
                self.create(plan.left), self.create(plan.right), plan.schema, plan.all
            )
        if isinstance(plan, Except):
            return ExceptOperator(
                self.create(plan.left), self.create(plan.right), plan.schema, plan.all
            )
        if isinstance(plan, Join):
            return self._join(plan)
        raise PlanningError(f"no physical operator for {type(plan).__name__}")

    def _scan(self, plan: Scan) -> Operator:
        """Build a scan, keeping only filters the source really accepted."""
        accepted = []
        supports = getattr(plan.source, "supports_filter_pushdown", None)
        for predicate in plan.filters:
            if callable(supports) and supports(predicate):
                accepted.append(predicate)
        projection = list(plan.projection) if plan.projection is not None else None
        return ScanOperator(plan.source, projection, accepted, plan.alias)

    def _join(self, plan: Join) -> Operator:
        """Choose a join algorithm based on the shape of the condition."""
        left = self.create(plan.left)
        right = self.create(plan.right)
        schema = plan.schema
        if plan.how == "cross":
            return NestedLoopJoinOperator(left, right, schema, None, "cross")
        keys = plan.equi_keys()
        if keys:
            return HashJoinOperator(
                left, right, schema, keys, plan.how, plan.residual_condition()
            )
        return NestedLoopJoinOperator(left, right, schema, plan.condition, plan.how)


def create_physical_plan(
    plan: LogicalPlan, context: Optional[ExecutionContext] = None
) -> Operator:
    """Translate a logical plan into an operator tree."""
    return PhysicalPlanner(context).create(plan)
