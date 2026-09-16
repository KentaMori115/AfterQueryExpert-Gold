"""LIMIT pushdown and merging.

Pushing a limit below a projection lets the scan stop early; merging nested
limits keeps the plan shallow when a subquery-style rewrite stacks two of
them.  A limit is never pushed below a sort, a join, or an aggregation, all of
which need the whole input to produce a correct first row.
"""

from __future__ import annotations

from dataclasses import replace

from ...plan.logical import EmptyRelation, Limit, LogicalPlan, Project
from ...plan.visitor import transform_up
from ..rule import Rule, RuleContext

__all__ = ["LimitPushdown", "merge_limits"]


class LimitPushdown(Rule):
    """Moves and merges LIMIT nodes."""

    name = "limit-pushdown"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return transform_up(plan, _rewrite)


def _rewrite(node: LogicalPlan) -> LogicalPlan:
    if not isinstance(node, Limit):
        return node
    if node.count == 0:
        return EmptyRelation(output_schema=node.schema)
    child = node.input
    if isinstance(child, Limit):
        return merge_limits(node, child)
    if isinstance(child, Project):
        return Project(
            input=Limit(input=child.input, count=node.count, offset=node.offset),
            projections=child.projections,
        )
    return node


def merge_limits(outer: Limit, inner: Limit) -> Limit:
    """Collapse ``LIMIT a OFFSET b`` over ``LIMIT c OFFSET d`` into one node.

    The inner limit sees the raw input, so the combined offset is the sum, and
    the combined count is bounded by whatever the inner node still has left
    after the outer offset is applied.
    """

    offset = inner.offset + outer.offset
    if inner.count is None:
        count = outer.count
    else:
        available = max(inner.count - outer.offset, 0)
        count = available if outer.count is None else min(outer.count, available)
    return replace(inner, count=count, offset=offset)
