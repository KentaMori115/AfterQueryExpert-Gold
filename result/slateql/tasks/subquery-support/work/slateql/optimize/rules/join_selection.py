"""Join input ordering.

Inner and cross joins are commutative, so the optimizer is free to put the
cheaper relation on the build side.  The physical hash join builds its table
from the *right* input, so the rule swaps children when the right side is
estimated to be materially larger than the left.

Outer joins are left untouched: swapping the arms of a LEFT JOIN changes which
rows get null-padded, so it is not a legal rewrite.
"""

from __future__ import annotations

from dataclasses import replace

from ...plan import expressions as X
from ...plan.logical import Join, LogicalPlan
from ...plan.visitor import transform_up
from ...sql.ast_nodes import JoinKind
from ..rule import Rule, RuleContext
from ..stats import estimate_cardinality

__all__ = ["JoinInputOrdering", "should_swap"]

#: The right side must be this many times larger before a swap is worthwhile.
SWAP_THRESHOLD = 1.5


class JoinInputOrdering(Rule):
    """Places the smaller relation on the hash join's build side."""

    name = "join-input-ordering"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        if not context.use_statistics:
            return plan

        def _rewrite(node: LogicalPlan) -> LogicalPlan:
            if not isinstance(node, Join):
                return node
            if node.kind not in (JoinKind.INNER, JoinKind.CROSS):
                return node
            if not should_swap(node, context):
                return node
            return replace(node, left=node.right, right=node.left)

        return transform_up(plan, _rewrite)


def should_swap(node: Join, context: RuleContext) -> bool:
    """Whether swapping this join's inputs lowers the estimated build cost."""

    left = estimate_cardinality(node.left, context)
    right = estimate_cardinality(node.right, context)
    if right <= left:
        return False
    return right > left * SWAP_THRESHOLD


def condition_is_symmetric(node: Join) -> bool:
    """Whether the join condition survives a swap unchanged.

    Equality conditions are symmetric under a swap because the executor
    resolves each side by column identity rather than by position.
    """

    if node.condition is None:
        return True
    return all(
        isinstance(conjunct, X.BinaryExpr) and conjunct.op in ("=", "<>")
        for conjunct in X.conjuncts(node.condition)
    )
