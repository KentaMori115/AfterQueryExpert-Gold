"""Rule-based logical plan optimization."""

from .cost import PlanCost, compare_costs, estimate_cost
from .pipeline import OptimizationTrace, Optimizer, default_rules
from .rule import FunctionRule, Rule, RuleContext
from .rules import (
    ConstantFolding,
    JoinInputOrdering,
    LimitPushdown,
    PredicatePushdown,
    ProjectionPruning,
    RemoveRedundantOperators,
    SimplifyExpressions,
)
from .stats import estimate_cardinality, estimate_selectivity

__all__ = [
    "PlanCost",
    "compare_costs",
    "estimate_cost",
    "Optimizer",
    "OptimizationTrace",
    "default_rules",
    "FunctionRule",
    "Rule",
    "RuleContext",
    "ConstantFolding",
    "JoinInputOrdering",
    "LimitPushdown",
    "PredicatePushdown",
    "ProjectionPruning",
    "RemoveRedundantOperators",
    "SimplifyExpressions",
    "estimate_cardinality",
    "estimate_selectivity",
]
