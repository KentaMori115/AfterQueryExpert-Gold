"""Predicate pushdown.

Filters are moved as close to the data as the semantics allow.  The rule works
one conjunct at a time so that a compound predicate can be split across
several relations: ``WHERE a.x = 1 AND b.y = 2`` pushes one comparison into
each side of a join and leaves nothing behind.

Outer joins constrain the movement: a predicate on the null-padded side cannot
move below the join, because a row that fails it must still be padded rather
than dropped.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Optional, Sequence

from ...plan import expressions as X
from ...plan.logical import (
    Aggregate,
    Filter,
    Join,
    LogicalPlan,
    Project,
    Scan,
    Sort,
)
from ...plan.visitor import transform_up
from ...sql.ast_nodes import JoinKind
from ...types.schema import Schema
from ..rule import Rule, RuleContext

__all__ = ["PredicatePushdown", "references_only"]


class PredicatePushdown(Rule):
    """Moves filter conjuncts down the plan tree."""

    name = "predicate-pushdown"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return transform_up(plan, _push_one)


def _push_one(node: LogicalPlan) -> LogicalPlan:
    if not isinstance(node, Filter):
        return node
    child = node.input

    if isinstance(child, Filter):
        merged = X.combine_and([child.predicate, node.predicate])
        assert merged is not None
        return Filter(input=child.input, predicate=merged)

    if isinstance(child, Sort):
        return Sort(
            input=Filter(input=child.input, predicate=node.predicate),
            keys=child.keys,
        )

    if isinstance(child, Project):
        return _push_through_project(node, child)

    if isinstance(child, Aggregate):
        return _push_through_aggregate(node, child)

    if isinstance(child, Join):
        return _push_through_join(node, child)

    if isinstance(child, Scan):
        return child.with_filters([*child.pushed_filters, *X.conjuncts(node.predicate)])

    return node


def _push_through_project(node: Filter, child: Project) -> LogicalPlan:
    """Substitute projection aliases and push what becomes expressible."""

    mapping: dict[str, X.Expr] = {
        item.name: item.expression for item in child.projections
    }
    if any(expression.is_volatile for expression in mapping.values()):
        return node

    pushable: list[X.Expr] = []
    kept: list[X.Expr] = []
    for conjunct in X.conjuncts(node.predicate):
        substituted = X.replace_columns(conjunct, mapping)
        if _resolvable_against(substituted, child.input.schema):
            pushable.append(substituted)
        else:
            kept.append(conjunct)

    if not pushable:
        return node

    pushed = X.combine_and(pushable)
    assert pushed is not None
    new_child = Project(
        input=Filter(input=child.input, predicate=pushed),
        projections=child.projections,
    )
    remaining = X.combine_and(kept)
    if remaining is None:
        return new_child
    return Filter(input=new_child, predicate=remaining)


def _push_through_aggregate(node: Filter, child: Aggregate) -> LogicalPlan:
    """Push conjuncts that only touch group keys below the aggregation."""

    mapping: dict[str, X.Expr] = {
        item.name: item.expression for item in child.group_by
    }
    aggregate_names = {item.name for item in child.aggregates}

    pushable: list[X.Expr] = []
    kept: list[X.Expr] = []
    for conjunct in X.conjuncts(node.predicate):
        names = {column.name for column in X.columns_of(conjunct)}
        if names & aggregate_names or not names <= set(mapping):
            kept.append(conjunct)
            continue
        substituted = X.replace_columns(conjunct, mapping)
        if _resolvable_against(substituted, child.input.schema):
            pushable.append(substituted)
        else:
            kept.append(conjunct)

    if not pushable:
        return node

    pushed = X.combine_and(pushable)
    assert pushed is not None
    new_child = replace(child, input=Filter(input=child.input, predicate=pushed))
    remaining = X.combine_and(kept)
    if remaining is None:
        return new_child
    return Filter(input=new_child, predicate=remaining)


def _push_through_join(node: Filter, child: Join) -> LogicalPlan:
    """Route each conjunct to the side it exclusively references."""

    left_schema = child.left.schema
    right_schema = child.right.schema
    can_push_left = child.kind in (JoinKind.INNER, JoinKind.CROSS, JoinKind.LEFT)
    can_push_right = child.kind in (JoinKind.INNER, JoinKind.CROSS, JoinKind.RIGHT)

    to_left: list[X.Expr] = []
    to_right: list[X.Expr] = []
    kept: list[X.Expr] = []

    for conjunct in X.conjuncts(node.predicate):
        if can_push_left and references_only(conjunct, left_schema):
            to_left.append(conjunct)
        elif can_push_right and references_only(conjunct, right_schema):
            to_right.append(conjunct)
        else:
            kept.append(conjunct)

    if not to_left and not to_right:
        return node

    left = child.left
    right = child.right
    left_predicate = X.combine_and(to_left)
    if left_predicate is not None:
        left = Filter(input=left, predicate=left_predicate)
    right_predicate = X.combine_and(to_right)
    if right_predicate is not None:
        right = Filter(input=right, predicate=right_predicate)

    new_join = replace(child, left=left, right=right)
    remaining = X.combine_and(kept)
    if remaining is None:
        return new_join
    return Filter(input=new_join, predicate=remaining)


def references_only(expression: X.Expr, schema: Schema) -> bool:
    """Whether every column in ``expression`` resolves inside ``schema``."""

    columns = X.columns_of(expression)
    if not columns:
        return False
    return all(
        schema.try_index_of(column.name, column.qualifier) is not None
        for column in columns
    )


def _resolvable_against(expression: X.Expr, schema: Schema) -> bool:
    """Like :func:`references_only` but tolerant of constant predicates."""

    columns = X.columns_of(expression)
    if not columns:
        return True
    return all(
        schema.try_index_of(column.name, column.qualifier) is not None
        for column in columns
    )


def split_conjuncts(
    predicate: Optional[X.Expr],
) -> Sequence[X.Expr]:  # pragma: no cover - thin wrapper
    """Public alias kept for callers outside the optimizer."""

    return X.conjuncts(predicate)
