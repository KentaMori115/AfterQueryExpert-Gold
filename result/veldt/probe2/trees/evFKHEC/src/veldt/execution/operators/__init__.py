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
from .setop import ExceptOperator, IntersectOperator, PairingOperator
from .sort import SortOperator
from .union import UnionOperator

__all__ = [
    "BinaryOperator",
    "DistinctOperator",
    "ExceptOperator",
    "FilterOperator",
    "HashAggregateOperator",
    "HashJoinOperator",
    "IntersectOperator",
    "LimitOperator",
    "NestedLoopJoinOperator",
    "PairingOperator",
    "Operator",
    "ProjectOperator",
    "ScanOperator",
    "SortOperator",
    "UnaryOperator",
    "UnionOperator",
    "unwrap_aggregate",
]
