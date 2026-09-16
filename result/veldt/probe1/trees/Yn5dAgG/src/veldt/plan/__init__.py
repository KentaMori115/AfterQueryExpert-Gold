"""Logical planning: nodes, rewrites, statistics and printing."""

from __future__ import annotations

from .builder import PlanBuilder, parse_sort_key
from .logical import (
    JOIN_TYPES,
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
    SortKey,
    Union,
)
from .optimizer import (
    OptimizationReport,
    Optimizer,
    default_optimizer,
    optimize,
)
from .printer import format_plan, format_plan_tree, format_schema, plan_summary
from .rules import (
    CombineFilters,
    CombineLimits,
    CombineProjections,
    ConstantFolding,
    EliminateRedundantDistinct,
    PredicatePushdown,
    ProjectionPushdown,
    RemoveTrivialFilter,
    Rule,
    default_rules,
)
from .stats import ColumnStatistics, Statistics, estimate

__all__ = [
    "Aggregate",
    "ColumnStatistics",
    "CombineFilters",
    "CombineLimits",
    "CombineProjections",
    "ConstantFolding",
    "Distinct",
    "Except",
    "EliminateRedundantDistinct",
    "Filter",
    "JOIN_TYPES",
    "Join",
    "Limit",
    "LogicalPlan",
    "OptimizationReport",
    "Optimizer",
    "PlanBuilder",
    "PredicatePushdown",
    "Project",
    "ProjectionPushdown",
    "RemoveTrivialFilter",
    "Rule",
    "Scan",
    "Sort",
    "SortKey",
    "Statistics",
    "Intersect",
    "Union",
    "default_optimizer",
    "default_rules",
    "estimate",
    "format_plan",
    "format_plan_tree",
    "format_schema",
    "optimize",
    "parse_sort_key",
    "plan_summary",
    "parse_sort_key",
]
