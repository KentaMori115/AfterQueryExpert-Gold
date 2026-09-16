"""Individual optimizer rules."""

from .constant_fold import ConstantFolding, fold_expression
from .join_selection import JoinInputOrdering, should_swap
from .limit_pushdown import LimitPushdown, merge_limits
from .predicate_pushdown import PredicatePushdown, references_only
from .projection_prune import ProjectionPruning, live_columns
from .redundant_ops import RemoveRedundantOperators
from .simplify import SimplifyExpressions, simplify

__all__ = [
    "ConstantFolding",
    "fold_expression",
    "JoinInputOrdering",
    "should_swap",
    "LimitPushdown",
    "merge_limits",
    "PredicatePushdown",
    "references_only",
    "ProjectionPruning",
    "live_columns",
    "RemoveRedundantOperators",
    "SimplifyExpressions",
    "simplify",
]
