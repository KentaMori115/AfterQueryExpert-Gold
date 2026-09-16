"""Physical planning and execution."""

from __future__ import annotations

from .context import ExecutionContext
from .operators import (
    BinaryOperator,
    DistinctOperator,
    ExceptOperator,
    FilterOperator,
    HashAggregateOperator,
    HashJoinOperator,
    IntersectOperator,
    LimitOperator,
    NestedLoopJoinOperator,
    Operator,
    ProjectOperator,
    ScanOperator,
    SortOperator,
    UnaryOperator,
    UnionOperator,
)
from .physical import PhysicalPlanner, create_physical_plan
from .pipeline import collect, execute_operator, execute_plan, stream_plan

__all__ = [
    "BinaryOperator",
    "DistinctOperator",
    "ExecutionContext",
    "ExceptOperator",
    "FilterOperator",
    "HashAggregateOperator",
    "HashJoinOperator",
    "IntersectOperator",
    "LimitOperator",
    "NestedLoopJoinOperator",
    "Operator",
    "PhysicalPlanner",
    "ProjectOperator",
    "ScanOperator",
    "SortOperator",
    "UnaryOperator",
    "UnionOperator",
    "collect",
    "create_physical_plan",
    "execute_operator",
    "execute_plan",
    "stream_plan",
]
