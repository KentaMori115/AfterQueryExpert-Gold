"""Physical operators."""

from __future__ import annotations

from .aggregate import HashAggregateOperator, unwrap_aggregate
from .base import BinaryOperator, Operator, UnaryOperator
from .distinct import DistinctOperator
from .filter import FilterOperator
from .join import HashJoinOperator, NestedLoopJoinOperator
from .limit import LimitOperator
from .project import ProjectOperator
from .scan import ScanOperator
from .sort import SortOperator
from .intersect import ExceptOperator, IntersectOperator
from .union import UnionOperator

__all__ = [
    "BinaryOperator",
    "DistinctOperator",
    "FilterOperator",
    "HashAggregateOperator",
    "HashJoinOperator",
    "LimitOperator",
    "NestedLoopJoinOperator",
    "Operator",
    "ProjectOperator",
    "ScanOperator",
    "SortOperator",
    "UnaryOperator",
    "ExceptOperator",
    "IntersectOperator",
    "UnionOperator",
    "unwrap_aggregate",
]
