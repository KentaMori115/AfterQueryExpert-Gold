"""Logical plan nodes.

A logical plan says *what* the query computes, not how. Every node is immutable
and derives its output schema from its children, so rewriting a plan is a
matter of rebuilding nodes bottom-up with :meth:`LogicalPlan.with_children`.

The optimizer in :mod:`veldt.plan.optimizer` and the physical planner in
:mod:`veldt.execution.physical` are the only two consumers.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from typing import TYPE_CHECKING, Any, List, Optional, Sequence, Tuple

from ..errors import PlanningError
from ..expr.ast import (
    AggregateCall,
    Alias,
    BinaryOp,
    ColumnRef,
    Expression,
    contains_aggregate,
    output_name,
)
from ..expr.resolver import ExpressionResolver
from ..types.dtypes import DataType
from ..types.schema import Field, Schema

if TYPE_CHECKING:  # pragma: no cover - import cycle guard
    from ..storage.base import DataSource

__all__ = [
    "LogicalPlan",
    "Scan",
    "Filter",
    "Project",
    "Aggregate",
    "Sort",
    "SortKey",
    "Limit",
    "Join",
    "Distinct",
    "Union",
    "Intersect",
    "Except",
    "SetOperation",
    "JOIN_TYPES",
]

JOIN_TYPES = ("inner", "left", "right", "full", "cross")

_RESOLVER = ExpressionResolver()


class LogicalPlan:
    """Base class for every logical plan node."""

    __slots__ = ()

    @property
    def schema(self) -> Schema:
        """The schema of the rows this node produces."""
        raise NotImplementedError

    def children(self) -> Tuple["LogicalPlan", ...]:
        """The node's input plans."""
        return ()

    def with_children(self, children: Sequence["LogicalPlan"]) -> "LogicalPlan":
        """Return a copy of this node with new inputs."""
        if children:
            raise ValueError(f"{type(self).__name__} takes no children")
        return self

    def expressions(self) -> Tuple[Expression, ...]:
        """Every expression this node evaluates."""
        return ()

    @property
    def node_name(self) -> str:
        """Short name used in plan output."""
        return type(self).__name__

    def describe(self) -> str:
        """One-line description used by the plan printer."""
        return self.node_name

    def walk(self):
        """Yield this node and every descendant, parents first."""
        yield self
        for child in self.children():
            yield from child.walk()

    def transform_up(self, rule) -> "LogicalPlan":
        """Rewrite the tree bottom-up, applying ``rule`` to every node."""
        children = self.children()
        if children:
            rewritten = [child.transform_up(rule) for child in children]
            if any(new is not old for new, old in zip(rewritten, children)):
                return rule(self.with_children(rewritten))
        return rule(self)

    def transform_down(self, rule) -> "LogicalPlan":
        """Rewrite the tree top-down, applying ``rule`` before recursing."""
        node = rule(self)
        children = node.children()
        if not children:
            return node
        rewritten = [child.transform_down(rule) for child in children]
        if any(new is not old for new, old in zip(rewritten, children)):
            return node.with_children(rewritten)
        return node

    def __str__(self) -> str:
        from .printer import format_plan

        return format_plan(self)


@dataclass(frozen=True)
class Scan(LogicalPlan):
    """Reads rows from a data source.

    Attributes:
        source: The data source object. It must expose ``name`` and ``schema``.
        alias: The name the query uses to refer to this input.
        projection: Column names to read, or ``None`` for all of them. Filled
            in by projection pushdown.
        filters: Predicates the source may apply itself. Filled in by predicate
            pushdown; a source that cannot use them leaves them to the filter
            operator above.
    """

    source: Any
    alias: Optional[str] = None
    projection: Optional[Tuple[str, ...]] = None
    filters: Tuple[Expression, ...] = ()

    def __post_init__(self) -> None:
        if self.projection is not None:
            object.__setattr__(self, "projection", tuple(self.projection))
        object.__setattr__(self, "filters", tuple(self.filters))

    @property
    def table_name(self) -> str:
        """The alias if one was given, otherwise the source's own name."""
        return self.alias or getattr(self.source, "name", "table")

    @property
    def schema(self) -> Schema:
        base: Schema = self.source.schema
        if self.projection is None:
            return base
        return base.select(list(self.projection))

    def expressions(self) -> Tuple[Expression, ...]:
        return self.filters

    def with_projection(self, names: Optional[Sequence[str]]) -> "Scan":
        """Return a copy reading only ``names``."""
        return Scan(self.source, self.alias, tuple(names) if names is not None else None, self.filters)

    def with_filters(self, filters: Sequence[Expression]) -> "Scan":
        """Return a copy carrying pushed-down predicates."""
        return Scan(self.source, self.alias, self.projection, tuple(filters))

    def describe(self) -> str:
        parts = [f"Scan: {self.table_name}"]
        if self.projection is not None:
            parts.append(f"projection=[{', '.join(self.projection)}]")
        if self.filters:
            rendered = ", ".join(item.to_sql() for item in self.filters)
            parts.append(f"filters=[{rendered}]")
        return " ".join(parts)


@dataclass(frozen=True)
class Filter(LogicalPlan):
    """Keeps rows whose predicate evaluates to true."""

    input: LogicalPlan
    predicate: Expression

    def __post_init__(self) -> None:
        if contains_aggregate(self.predicate):
            raise PlanningError("aggregates are not allowed in a filter predicate")

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Filter":
        _expect(children, 1, "Filter")
        return Filter(children[0], self.predicate)

    def expressions(self) -> Tuple[Expression, ...]:
        return (self.predicate,)

    def describe(self) -> str:
        return f"Filter: {self.predicate.to_sql()}"


@dataclass(frozen=True)
class Project(LogicalPlan):
    """Computes a new set of columns from its input."""

    input: LogicalPlan
    projections: Tuple[Expression, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "projections", tuple(self.projections))
        if not self.projections:
            raise PlanningError("a projection must produce at least one column")
        for expression in self.projections:
            if contains_aggregate(expression):
                raise PlanningError(
                    "aggregates must be computed by an aggregation, not a projection"
                )

    @property
    def schema(self) -> Schema:
        return _RESOLVER.resolve_schema(self.projections, self.input.schema)

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Project":
        _expect(children, 1, "Project")
        return Project(children[0], self.projections)

    def expressions(self) -> Tuple[Expression, ...]:
        return self.projections

    def is_identity(self) -> bool:
        """True when this projection selects exactly its input, unchanged."""
        input_names = self.input.schema.names
        if len(self.projections) != len(input_names):
            return False
        for expression, name in zip(self.projections, input_names):
            if not isinstance(expression, ColumnRef) or expression.name.lower() != name.lower():
                return False
        return True

    def describe(self) -> str:
        rendered = ", ".join(item.to_sql() for item in self.projections)
        return f"Project: {rendered}"


@dataclass(frozen=True)
class Aggregate(LogicalPlan):
    """Groups rows and computes aggregates over each group.

    An aggregation with no grouping expressions produces exactly one row, even
    when the input is empty, which is what ``SELECT COUNT(*) FROM t`` requires.
    """

    input: LogicalPlan
    group_by: Tuple[Expression, ...] = ()
    aggregates: Tuple[Expression, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "group_by", tuple(self.group_by))
        object.__setattr__(self, "aggregates", tuple(self.aggregates))
        if not self.group_by and not self.aggregates:
            raise PlanningError("an aggregation needs grouping keys or aggregate expressions")
        for expression in self.group_by:
            if contains_aggregate(expression):
                raise PlanningError("grouping keys must not contain aggregates")

    @property
    def is_global(self) -> bool:
        """True when the aggregation has no grouping keys."""
        return not self.group_by

    @property
    def schema(self) -> Schema:
        input_schema = self.input.schema
        fields: List[Field] = []
        for expression in self.group_by:
            fields.append(_RESOLVER.resolve_field(expression, input_schema))
        for expression in self.aggregates:
            fields.append(_RESOLVER.resolve_field(expression, input_schema))
        return Schema(_disambiguate(fields))

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Aggregate":
        _expect(children, 1, "Aggregate")
        return Aggregate(children[0], self.group_by, self.aggregates)

    def expressions(self) -> Tuple[Expression, ...]:
        return self.group_by + self.aggregates

    def describe(self) -> str:
        groups = ", ".join(item.to_sql() for item in self.group_by) or "()"
        aggs = ", ".join(item.to_sql() for item in self.aggregates) or "()"
        return f"Aggregate: groupBy={groups} aggregates={aggs}"


@dataclass(frozen=True)
class SortKey:
    """One ``ORDER BY`` term."""

    expression: Expression
    ascending: bool = True
    nulls_first: Optional[bool] = None

    @property
    def nulls_first_effective(self) -> bool:
        """Resolve the default null placement.

        Nulls sort as the smallest values, so they come first ascending and
        last descending unless the query says otherwise.
        """
        if self.nulls_first is not None:
            return self.nulls_first
        return self.ascending

    def describe(self) -> str:
        """Render the key as it would appear in ``ORDER BY``."""
        direction = "ASC" if self.ascending else "DESC"
        nulls = "NULLS FIRST" if self.nulls_first_effective else "NULLS LAST"
        return f"{self.expression.to_sql()} {direction} {nulls}"


@dataclass(frozen=True)
class Sort(LogicalPlan):
    """Orders rows by one or more keys."""

    input: LogicalPlan
    keys: Tuple[SortKey, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "keys", tuple(self.keys))
        if not self.keys:
            raise PlanningError("a sort needs at least one key")

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Sort":
        _expect(children, 1, "Sort")
        return Sort(children[0], self.keys)

    def expressions(self) -> Tuple[Expression, ...]:
        return tuple(key.expression for key in self.keys)

    def describe(self) -> str:
        return "Sort: " + ", ".join(key.describe() for key in self.keys)


@dataclass(frozen=True)
class Limit(LogicalPlan):
    """Returns at most ``count`` rows after skipping ``offset`` of them."""

    input: LogicalPlan
    count: Optional[int] = None
    offset: int = 0

    def __post_init__(self) -> None:
        if self.count is not None and self.count < 0:
            raise PlanningError("LIMIT must not be negative")
        if self.offset < 0:
            raise PlanningError("OFFSET must not be negative")

    @property
    def schema(self) -> Schema:
        return self.input.schema

    @property
    def fetch(self) -> Optional[int]:
        """Total rows that must be produced by the input, including the offset."""
        return None if self.count is None else self.count + self.offset

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Limit":
        _expect(children, 1, "Limit")
        return Limit(children[0], self.count, self.offset)

    def describe(self) -> str:
        count = "all" if self.count is None else str(self.count)
        return f"Limit: count={count} offset={self.offset}"


@dataclass(frozen=True)
class Join(LogicalPlan):
    """Combines two inputs.

    Attributes:
        how: One of ``inner``, ``left``, ``right``, ``full`` or ``cross``.
        condition: The join predicate. A cross join has none.
    """

    left: LogicalPlan
    right: LogicalPlan
    condition: Optional[Expression] = None
    how: str = "inner"

    def __post_init__(self) -> None:
        object.__setattr__(self, "how", self.how.lower())
        if self.how not in JOIN_TYPES:
            raise PlanningError(f"unknown join type {self.how!r}")
        if self.how == "cross" and self.condition is not None:
            raise PlanningError("a cross join must not have a condition")
        if self.how != "cross" and self.condition is None:
            raise PlanningError(f"a {self.how} join requires a condition")

    @property
    def schema(self) -> Schema:
        return self.left.schema.merge(self.right.schema)

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Join":
        _expect(children, 2, "Join")
        return Join(children[0], children[1], self.condition, self.how)

    def expressions(self) -> Tuple[Expression, ...]:
        return (self.condition,) if self.condition is not None else ()

    def equi_keys(self) -> List[Tuple[Expression, Expression]]:
        """Extract ``left = right`` pairs usable as hash join keys.

        Only conjunctions of equality comparisons qualify, and each side of an
        equality must reference columns from exactly one input. Anything else
        stays as a residual predicate.
        """
        from ..expr.simplify import split_conjunction

        left_names = {name.lower() for name in self.left.schema.names}
        right_names = {name.lower() for name in self.right.schema.names}
        pairs: List[Tuple[Expression, Expression]] = []
        for term in split_conjunction(self.condition):
            if not isinstance(term, BinaryOp) or term.operator != "=":
                continue
            left_side = _side_of(term.left, left_names, right_names)
            right_side = _side_of(term.right, left_names, right_names)
            if left_side == "left" and right_side == "right":
                pairs.append((term.left, term.right))
            elif left_side == "right" and right_side == "left":
                pairs.append((term.right, term.left))
        return pairs

    def residual_condition(self) -> Optional[Expression]:
        """Return the part of the condition not covered by :meth:`equi_keys`."""
        from ..expr.simplify import combine_conjunction, split_conjunction

        keys = self.equi_keys()
        used = {(left, right) for left, right in keys} | {(right, left) for left, right in keys}
        remaining = []
        for term in split_conjunction(self.condition):
            if isinstance(term, BinaryOp) and term.operator == "=":
                if (term.left, term.right) in used:
                    continue
            remaining.append(term)
        return combine_conjunction(remaining)

    def describe(self) -> str:
        if self.condition is None:
            return f"Join: how={self.how}"
        return f"Join: how={self.how} on={self.condition.to_sql()}"


@dataclass(frozen=True)
class Distinct(LogicalPlan):
    """Removes duplicate rows, keeping the first occurrence of each."""

    input: LogicalPlan

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> "Distinct":
        _expect(children, 1, "Distinct")
        return Distinct(children[0])

    def describe(self) -> str:
        return "Distinct"


@dataclass(frozen=True)
class SetOperation(LogicalPlan):
    """Common shape of the three set operators.

    Each takes two inputs with matching column counts, and all three publish the same schema: names from the left input, types unified
    pairwise, a column nullable when either side's is. ``all`` distinguishes
    the multiset spelling from the plain one.
    """

    left: LogicalPlan
    right: LogicalPlan
    all: bool = False

    @property
    def schema(self) -> Schema:
        return self.left.schema.union(self.right.schema)

    def children(self) -> Tuple[LogicalPlan, ...]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[LogicalPlan]) -> "SetOperation":
        _expect(children, 2, self.node_name)
        return type(self)(children[0], children[1], self.all)

    def describe(self) -> str:
        return f"{self.node_name}: {'all' if self.all else 'distinct'}"


@dataclass(frozen=True)
class Union(SetOperation):
    """Concatenates two inputs with matching column counts."""


@dataclass(frozen=True)
class Intersect(SetOperation):
    """Keeps rows both inputs produced.

    Plainly spelled, each surviving row appears once. With ``all``, a row
    supplied ``m`` times on the left and ``n`` times on the right survives
    ``min(m, n)`` times.
    """


@dataclass(frozen=True)
class Except(SetOperation):
    """Keeps left rows the right input never produced.

    Plainly spelled, each surviving row appears once. With ``all``, a row
    supplied ``m`` times on the left and ``n`` times on the right survives
    ``max(m - n, 0)`` times.
    """


def _expect(children: Sequence[LogicalPlan], count: int, node: str) -> None:
    """Raise when a rewrite supplies the wrong number of children."""
    if len(children) != count:
        raise ValueError(f"{node} expects {count} children, got {len(children)}")


def _disambiguate(fields: Sequence[Field]) -> List[Field]:
    """Append numeric suffixes so every output field name is unique."""
    taken: set = set()
    result: List[Field] = []
    for item in fields:
        name = item.name
        counter = 1
        while name.lower() in taken:
            counter += 1
            name = f"{item.name}_{counter}"
        taken.add(name.lower())
        result.append(item.rename(name) if name != item.name else item)
    return result


def _side_of(expression: Expression, left_names: set, right_names: set) -> Optional[str]:
    """Return which input an expression's columns come from, if just one."""
    from ..expr.ast import collect_columns

    references = collect_columns(expression)
    if not references:
        return None
    sides = set()
    for reference in references:
        lowered = reference.name.lower()
        qualified = (
            f"{reference.qualifier}.{reference.name}".lower() if reference.qualifier else None
        )
        if lowered in left_names or (qualified and qualified in left_names):
            sides.add("left")
        elif lowered in right_names or (qualified and qualified in right_names):
            sides.add("right")
        else:
            return None
    return sides.pop() if len(sides) == 1 else None
