"""Generic traversal and rewriting helpers for logical plans.

Optimizer rules are written as pure functions from plan to plan.  These
helpers supply the plumbing: bottom-up and top-down traversal, expression
rewriting that recurses into every expression a node owns, and structural
equality that ignores object identity.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Callable, Optional, Sequence

from .expressions import Expr
from .logical import (
    Aggregate,
    Filter,
    Join,
    LogicalPlan,
    NamedExpr,
    Project,
    Scan,
    Sort,
    SortItem,
)

__all__ = [
    "transform_up",
    "transform_down",
    "map_expressions",
    "collect",
    "count_nodes",
    "plan_depth",
    "same_plan",
]

PlanRewrite = Callable[[LogicalPlan], LogicalPlan]
ExprRewrite = Callable[[Expr], Expr]


def _rebuild(plan: LogicalPlan, children: Sequence[LogicalPlan]) -> LogicalPlan:
    old = plan.children()
    if len(children) == len(old) and all(a is b for a, b in zip(children, old)):
        return plan
    return plan.with_children(children)


def transform_up(plan: LogicalPlan, rule: PlanRewrite) -> LogicalPlan:
    """Apply ``rule`` to every node, children before parents."""

    children = [transform_up(child, rule) for child in plan.children()]
    return rule(_rebuild(plan, children))


def transform_down(plan: LogicalPlan, rule: PlanRewrite) -> LogicalPlan:
    """Apply ``rule`` to every node, parents before children."""

    rewritten = rule(plan)
    children = [transform_down(child, rule) for child in rewritten.children()]
    return _rebuild(rewritten, children)


def map_expressions(plan: LogicalPlan, rule: ExprRewrite) -> LogicalPlan:
    """Rewrite every expression owned directly by ``plan``.

    Child plans are left untouched; combine with :func:`transform_up` to reach
    the whole tree.
    """

    if isinstance(plan, Filter):
        predicate = rule(plan.predicate)
        return plan if predicate is plan.predicate else replace(plan, predicate=predicate)
    if isinstance(plan, Project):
        projections = _map_named(plan.projections, rule)
        if projections is None:
            return plan
        return replace(plan, projections=projections)
    if isinstance(plan, Aggregate):
        groups = _map_named(plan.group_by, rule)
        aggs = _map_named(plan.aggregates, rule)
        if groups is None and aggs is None:
            return plan
        return replace(
            plan,
            group_by=groups if groups is not None else plan.group_by,
            aggregates=aggs if aggs is not None else plan.aggregates,
        )
    if isinstance(plan, Sort):
        keys: list[SortItem] = []
        changed = False
        for key in plan.keys:
            expression = rule(key.expression)
            if expression is not key.expression:
                changed = True
                keys.append(replace(key, expression=expression))
            else:
                keys.append(key)
        return replace(plan, keys=tuple(keys)) if changed else plan
    if isinstance(plan, Join):
        if plan.condition is None:
            return plan
        condition = rule(plan.condition)
        return plan if condition is plan.condition else replace(plan, condition=condition)
    if isinstance(plan, Scan):
        if not plan.pushed_filters:
            return plan
        filters = tuple(rule(f) for f in plan.pushed_filters)
        if all(a is b for a, b in zip(filters, plan.pushed_filters)):
            return plan
        return replace(plan, pushed_filters=filters)
    return plan


def _map_named(
    items: Sequence[NamedExpr], rule: ExprRewrite
) -> Optional[tuple[NamedExpr, ...]]:
    out: list[NamedExpr] = []
    changed = False
    for item in items:
        expression = rule(item.expression)
        if expression is not item.expression:
            changed = True
            out.append(NamedExpr(expression=expression, name=item.name))
        else:
            out.append(item)
    return tuple(out) if changed else None


def collect(plan: LogicalPlan, predicate: Callable[[LogicalPlan], bool]) -> list[LogicalPlan]:
    """Every node satisfying ``predicate``, in pre-order."""

    return [node for node in plan.walk() if predicate(node)]


def count_nodes(plan: LogicalPlan) -> int:
    """Total number of nodes in the tree."""

    return sum(1 for _ in plan.walk())


def plan_depth(plan: LogicalPlan) -> int:
    """Length of the longest root-to-leaf path."""

    children = plan.children()
    if not children:
        return 1
    return 1 + max(plan_depth(child) for child in children)


def same_plan(left: LogicalPlan, right: LogicalPlan) -> bool:
    """Structural comparison used by the optimizer's fixed-point loop."""

    if left is right:
        return True
    if type(left) is not type(right):
        return False
    if left != right:
        return False
    left_children = left.children()
    right_children = right.children()
    if len(left_children) != len(right_children):
        return False
    return all(same_plan(a, b) for a, b in zip(left_children, right_children))
