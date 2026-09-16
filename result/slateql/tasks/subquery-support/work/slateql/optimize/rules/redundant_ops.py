"""Removal of no-op and unreachable plan nodes.

Binding is deliberately literal: it emits a projection for every SELECT even
when the projection reproduces its input, and it emits a Limit node whenever
either LIMIT or OFFSET appeared.  This rule cleans the resulting plan up, and
propagates provably empty relations upward so that an unsatisfiable filter
prunes the whole subtree.
"""

from __future__ import annotations

from dataclasses import replace

from ...plan import expressions as X
from ...plan.logical import (
    Distinct,
    EmptyRelation,
    Filter,
    Limit,
    LogicalPlan,
    Project,
    Sort,
    SubqueryAlias,
)
from ...plan.visitor import transform_up
from ..rule import Rule, RuleContext

__all__ = ["RemoveRedundantOperators"]


class RemoveRedundantOperators(Rule):
    """Drops identity projections, no-op limits, and repeated set operators."""

    name = "remove-redundant-operators"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return transform_up(plan, _rewrite)


def _rewrite(node: LogicalPlan) -> LogicalPlan:
    if isinstance(node, Filter):
        return _rewrite_filter(node)
    if isinstance(node, Project):
        if node.is_identity:
            return node.input
        if isinstance(node.input, EmptyRelation):
            return EmptyRelation(output_schema=node.schema)
        return node
    if isinstance(node, Limit):
        if node.count is None and node.offset == 0:
            return node.input
        if node.count == 0:
            return EmptyRelation(output_schema=node.schema)
        if isinstance(node.input, EmptyRelation):
            return node.input
        return node
    if isinstance(node, Distinct):
        if isinstance(node.input, Distinct):
            return node.input
        if isinstance(node.input, EmptyRelation):
            return node.input
        return node
    if isinstance(node, Sort):
        if isinstance(node.input, Sort):
            return replace(node, input=node.input.input)
        if isinstance(node.input, EmptyRelation):
            return node.input
        return node
    if isinstance(node, SubqueryAlias):
        if isinstance(node.input, EmptyRelation):
            return EmptyRelation(output_schema=node.schema)
        return node
    return node


def _rewrite_filter(node: Filter) -> LogicalPlan:
    predicate = node.predicate
    if isinstance(predicate, X.Literal):
        if predicate.value is True:
            return node.input
        if predicate.value is False or predicate.value is None:
            return EmptyRelation(output_schema=node.schema)
    if isinstance(node.input, EmptyRelation):
        return node.input
    return node
