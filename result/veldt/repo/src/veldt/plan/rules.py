"""Optimizer rules.

Each rule is a self-contained plan-to-plan rewrite. Rules must be:

*semantics preserving*
    The rewritten plan produces the same rows in the same order.

*idempotent*
    Applying a rule to its own output changes nothing, so the optimizer's
    fixpoint loop terminates.

*independent*
    A rule may assume nothing about which other rules ran first. The optimizer
    applies them repeatedly until the plan stops changing.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Set

from ..expr.ast import (
    Alias,
    ColumnRef,
    Expression,
    collect_columns,
    contains_aggregate,
    output_name,
    transform,
)
from ..expr.simplify import combine_conjunction, simplify, split_conjunction
from .logical import (
    Aggregate,
    Distinct,
    Filter,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
    SortKey,
    Union,
)

__all__ = [
    "Rule",
    "ConstantFolding",
    "CombineFilters",
    "RemoveTrivialFilter",
    "PredicatePushdown",
    "ProjectionPushdown",
    "CombineProjections",
    "CombineLimits",
    "EliminateRedundantDistinct",
    "default_rules",
    "substitute",
]


class Rule:
    """Base class for a plan rewrite."""

    name = "rule"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        """Return a rewritten plan, or the original when nothing applies."""
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"<{self.name}>"


def substitute(expression: Expression, mapping: Dict[str, Expression]) -> Expression:
    """Replace column references using a lowercase name to expression map.

    Used when pushing a predicate below a projection: the predicate speaks in
    the projection's output names, and must be rewritten to speak in its input
    names instead.
    """

    def rule(node: Expression) -> Expression:
        if isinstance(node, ColumnRef):
            replacement = mapping.get(node.name.lower())
            if replacement is not None:
                return replacement
        return node

    return transform(expression, rule)


class ConstantFolding(Rule):
    """Folds constant sub-expressions and applies boolean identities."""

    name = "ConstantFolding"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if isinstance(node, Filter):
            folded = simplify(node.predicate)
            return node if folded == node.predicate else Filter(node.input, folded)
        if isinstance(node, Project):
            folded = tuple(self._simplify_named(item) for item in node.projections)
            return node if folded == node.projections else Project(node.input, folded)
        if isinstance(node, Aggregate):
            groups = tuple(self._simplify_named(item) for item in node.group_by)
            aggs = tuple(self._simplify_named(item) for item in node.aggregates)
            if groups == node.group_by and aggs == node.aggregates:
                return node
            return Aggregate(node.input, groups, aggs)
        if isinstance(node, Join) and node.condition is not None:
            folded = simplify(node.condition)
            return node if folded == node.condition else Join(node.left, node.right, folded, node.how)
        return node

    def _simplify_named(self, expression: Expression) -> Expression:
        """Simplify without losing the name the expression contributes.

        Folding ``1 + 1`` inside a projection would otherwise rename the output
        column from ``1 + 1`` to ``2``, silently changing the result schema.
        """
        if isinstance(expression, Alias):
            return Alias(simplify(expression.child), expression.name)
        folded = simplify(expression)
        if folded == expression:
            return expression
        if output_name(folded) != output_name(expression):
            return Alias(folded, output_name(expression))
        return folded


class CombineFilters(Rule):
    """Merges adjacent filters into a single conjunction."""

    name = "CombineFilters"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if isinstance(node, Filter) and isinstance(node.input, Filter):
            terms = split_conjunction(node.input.predicate) + split_conjunction(node.predicate)
            combined = combine_conjunction(_dedupe(terms))
            if combined is None:
                return node.input.input
            return Filter(node.input.input, combined)
        return node


class RemoveTrivialFilter(Rule):
    """Drops filters that keep every row and collapses ones that keep none."""

    name = "RemoveTrivialFilter"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if not isinstance(node, Filter):
            return node
        from ..expr.ast import Literal

        predicate = node.predicate
        if isinstance(predicate, Literal):
            if predicate.value is True:
                return node.input
            if predicate.value is False or predicate.value is None:
                return Limit(node.input, 0)
        terms = _dedupe(split_conjunction(predicate))
        if len(terms) != len(split_conjunction(predicate)):
            combined = combine_conjunction(terms)
            return node.input if combined is None else Filter(node.input, combined)
        return node


class PredicatePushdown(Rule):
    """Moves filter terms as close to the scans as their columns allow.

    Each conjunct is considered separately, so ``WHERE a.x = 1 AND b.y = 2``
    over a join sends one term to each side. Terms that cannot move stay where
    they are.
    """

    name = "PredicatePushdown"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_down(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if not isinstance(node, Filter):
            return node
        child = node.input
        if isinstance(child, Project):
            return self._through_project(node, child)
        if isinstance(child, Sort):
            return Sort(Filter(child.input, node.predicate), child.keys)
        if isinstance(child, Join):
            return self._through_join(node, child)
        if isinstance(child, Scan):
            return self._into_scan(node, child)
        if isinstance(child, Union):
            return Union(
                Filter(child.left, node.predicate),
                Filter(child.right, node.predicate),
                child.all,
            )
        return node

    def _through_project(self, node: Filter, child: Project) -> LogicalPlan:
        """Rewrite a predicate in terms of the projection's inputs."""
        mapping: Dict[str, Expression] = {}
        for expression in child.projections:
            source = expression.child if isinstance(expression, Alias) else expression
            if contains_aggregate(source):
                return node
            mapping[output_name(expression).lower()] = source
        movable: List[Expression] = []
        blocked: List[Expression] = []
        for term in split_conjunction(node.predicate):
            names = [reference.name.lower() for reference in collect_columns(term)]
            if all(name in mapping for name in names):
                movable.append(substitute(term, mapping))
            else:
                blocked.append(term)
        if not movable:
            return node
        pushed = combine_conjunction(movable)
        rebuilt: LogicalPlan = Project(Filter(child.input, pushed), child.projections)
        remaining = combine_conjunction(blocked)
        return rebuilt if remaining is None else Filter(rebuilt, remaining)

    def _through_join(self, node: Filter, child: Join) -> LogicalPlan:
        """Route each conjunct to the join side that owns its columns.

        The predicate speaks in the join's *output* names, and a join renames
        duplicate right-side columns. Sides are therefore decided on the merged
        schema, and a term bound for the right input is translated back into
        that input's own column names before being pushed.
        """
        left_owned, right_map = _join_column_sides(child)
        to_left: List[Expression] = []
        to_right: List[Expression] = []
        stay: List[Expression] = []
        # An outer join's null-extended side must not be filtered early: doing
        # so would turn unmatched rows into no rows instead of null-padded ones.
        allow_left = child.how in ("inner", "cross", "left")
        allow_right = child.how in ("inner", "cross", "right")
        for term in split_conjunction(node.predicate):
            names = {reference.name.lower() for reference in collect_columns(term)}
            if not names:
                stay.append(term)
            elif names <= left_owned and allow_left:
                to_left.append(term)
            elif names <= set(right_map) and allow_right:
                rename = {name: ColumnRef(right_map[name]) for name in names}
                to_right.append(substitute(term, rename))
            else:
                stay.append(term)
        if not to_left and not to_right:
            return node
        left = child.left
        right = child.right
        left_predicate = combine_conjunction(to_left)
        if left_predicate is not None:
            left = Filter(left, left_predicate)
        right_predicate = combine_conjunction(to_right)
        if right_predicate is not None:
            right = Filter(right, right_predicate)
        rebuilt: LogicalPlan = Join(left, right, child.condition, child.how)
        remaining = combine_conjunction(stay)
        return rebuilt if remaining is None else Filter(rebuilt, remaining)

    def _into_scan(self, node: Filter, child: Scan) -> LogicalPlan:
        """Hand predicates to a source that advertises it can use them."""
        supports = getattr(child.source, "supports_filter_pushdown", None)
        if not callable(supports):
            return node
        accepted: List[Expression] = []
        rejected: List[Expression] = []
        existing = list(child.filters)
        for term in split_conjunction(node.predicate):
            if term in existing:
                continue
            if supports(term):
                accepted.append(term)
            else:
                rejected.append(term)
        if not accepted:
            return node
        rebuilt: LogicalPlan = child.with_filters(existing + accepted)
        remaining = combine_conjunction(rejected)
        return rebuilt if remaining is None else Filter(rebuilt, remaining)


class ProjectionPushdown(Rule):
    """Narrows scans to the columns the query actually reads."""

    name = "ProjectionPushdown"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return self._prune(plan, {name.lower() for name in plan.schema.names})

    def _prune(self, node: LogicalPlan, required: Optional[Set[str]]) -> LogicalPlan:
        if isinstance(node, Scan):
            return self._prune_scan(node, required)
        if isinstance(node, Project):
            needed = _columns_of(node.projections)
            return Project(self._prune(node.input, needed), node.projections)
        if isinstance(node, Filter):
            needed = _merge(required, _columns_of([node.predicate]))
            return Filter(self._prune(node.input, needed), node.predicate)
        if isinstance(node, Aggregate):
            needed = _columns_of(node.group_by + node.aggregates)
            return Aggregate(self._prune(node.input, needed), node.group_by, node.aggregates)
        if isinstance(node, Sort):
            needed = _merge(required, _columns_of(node.expressions()))
            return Sort(self._prune(node.input, needed), node.keys)
        if isinstance(node, Limit):
            return Limit(self._prune(node.input, required), node.count, node.offset)
        if isinstance(node, Join):
            return self._prune_join(node, required)
        if isinstance(node, (Distinct, Union)):
            # Both operators compare whole rows, so no column may be dropped.
            return node.with_children([self._prune(child, None) for child in node.children()])
        return node

    def _prune_scan(self, node: Scan, required: Optional[Set[str]]) -> Scan:
        if required is None:
            return node
        available = node.source.schema.names
        needed = _merge(required, _columns_of(node.filters)) or set()
        kept = [name for name in available if name.lower() in needed]
        if not kept:
            # Every plan needs at least one column to count rows against.
            kept = available[:1]
        if node.projection is not None and list(node.projection) == kept:
            return node
        if len(kept) == len(available) and node.projection is None:
            return node
        return node.with_projection(kept)

    def _prune_join(self, node: Join, required: Optional[Set[str]]) -> LogicalPlan:
        """Split the required columns between the two inputs.

        Requirements arrive as output names, so right-side names are mapped
        back through the join's renaming before being handed down.
        """
        needed = _merge(required, _columns_of(node.expressions()))
        left_owned, right_map = _join_column_sides(node)
        left_required = None if needed is None else {n for n in needed if n in left_owned}
        right_required = (
            None
            if needed is None
            else {right_map[n].lower() for n in needed if n in right_map}
        )
        return Join(
            self._prune(node.left, left_required),
            self._prune(node.right, right_required),
            node.condition,
            node.how,
        )


class CombineProjections(Rule):
    """Collapses a projection over a projection when it is safe to inline."""

    name = "CombineProjections"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if not isinstance(node, Project) or not isinstance(node.input, Project):
            return node
        inner = node.input
        mapping: Dict[str, Expression] = {}
        for expression in inner.projections:
            source = expression.child if isinstance(expression, Alias) else expression
            mapping[output_name(expression).lower()] = source
        combined: List[Expression] = []
        for expression in node.projections:
            name = output_name(expression)
            source = expression.child if isinstance(expression, Alias) else expression
            # Inlining an expression more than once would duplicate work.
            references = collect_columns(source)
            if any(_is_expensive(mapping.get(item.name.lower())) for item in references):
                return node
            rewritten = substitute(source, mapping)
            combined.append(
                Alias(rewritten, name) if output_name(rewritten) != name else rewritten
            )
        return Project(inner.input, tuple(combined))


class CombineLimits(Rule):
    """Merges nested limits into the most restrictive equivalent one."""

    name = "CombineLimits"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if not isinstance(node, Limit) or not isinstance(node.input, Limit):
            return node
        inner = node.input
        offset = inner.offset + node.offset
        available = None if inner.count is None else max(inner.count - node.offset, 0)
        if node.count is None:
            count = available
        elif available is None:
            count = node.count
        else:
            count = min(node.count, available)
        return Limit(inner.input, count, offset)


class EliminateRedundantDistinct(Rule):
    """Removes a ``DISTINCT`` whose input is already unique."""

    name = "EliminateRedundantDistinct"

    def apply(self, plan: LogicalPlan) -> LogicalPlan:
        return plan.transform_up(self._rewrite)

    def _rewrite(self, node: LogicalPlan) -> LogicalPlan:
        if not isinstance(node, Distinct):
            return node
        child = node.input
        if isinstance(child, Distinct):
            return child
        if isinstance(child, Aggregate) and child.group_by and not child.aggregates:
            return child
        if isinstance(child, Aggregate) and child.is_global:
            return child
        return node


def default_rules() -> List[Rule]:
    """Return the rule set the engine applies by default, in order."""
    return [
        ConstantFolding(),
        RemoveTrivialFilter(),
        CombineFilters(),
        PredicatePushdown(),
        CombineProjections(),
        CombineLimits(),
        EliminateRedundantDistinct(),
        ProjectionPushdown(),
    ]


def _join_column_sides(node: Join) -> tuple:
    """Map a join's output column names onto the input that produced them.

    Returns:
        A pair of ``(left_owned, right_map)``. ``left_owned`` is the set of
        lowercase output names the left input contributes; ``right_map`` maps
        each lowercase output name the right input contributes to that input's
        own spelling of it, which is what the renaming may have changed.
    """
    output = node.schema.names
    width = len(node.left.schema)
    left_owned = {name.lower() for name in output[:width]}
    right_map = {
        output[width + index].lower(): field.name
        for index, field in enumerate(node.right.schema)
    }
    return left_owned, right_map


def _columns_of(expressions: Sequence[Expression]) -> Set[str]:
    """Return the lowercase column names referenced by ``expressions``."""
    names: Set[str] = set()
    for expression in expressions:
        for reference in collect_columns(expression):
            names.add(reference.name.lower())
            if reference.qualifier:
                names.add(f"{reference.qualifier}.{reference.name}".lower())
    return names


def _merge(required: Optional[Set[str]], extra: Set[str]) -> Optional[Set[str]]:
    """Union two requirement sets, propagating "everything is required"."""
    if required is None:
        return None
    return required | extra


def _dedupe(terms: Sequence[Expression]) -> List[Expression]:
    """Drop repeated conjuncts while preserving order."""
    seen: List[Expression] = []
    for term in terms:
        if term not in seen:
            seen.append(term)
    return seen


def _is_expensive(expression: Optional[Expression]) -> bool:
    """True when inlining an expression twice would be wasteful.

    Anything that is not a bare column reference or literal counts, which keeps
    projection collapsing to the cases where it is unambiguously a win.
    """
    from ..expr.ast import Literal

    if expression is None:
        return False
    return not isinstance(expression, (ColumnRef, Literal))
