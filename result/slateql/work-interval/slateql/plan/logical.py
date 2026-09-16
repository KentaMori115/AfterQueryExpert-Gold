"""Logical plan nodes.

A logical plan says *what* the query computes, not how.  Every node owns an
immutable schema derived from its children, which means optimizer rules can
rebuild a subtree and immediately see whether the rewrite preserved the output
shape.

The tree is produced by :mod:`slateql.analyze`, rewritten by
:mod:`slateql.optimize`, and lowered to operators by
:mod:`slateql.execution.planner`.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Iterator, Optional, Sequence

from ..errors import PlanningError
from ..sql.ast_nodes import JoinKind
from ..types.schema import Field, Schema
from .expressions import AggregateCall, Column, Expr

__all__ = [
    "LogicalPlan",
    "NamedExpr",
    "SortItem",
    "SetOpKind",
    "Scan",
    "Filter",
    "Project",
    "Aggregate",
    "Sort",
    "Limit",
    "Distinct",
    "Join",
    "SetOp",
    "OneRow",
    "EmptyRelation",
    "walk_plan",
]


@dataclass(frozen=True)
class NamedExpr:
    """An expression paired with the output column name it produces."""

    expression: Expr
    name: str

    def to_field(self, qualifier: Optional[str] = None) -> Field:
        return Field(name=self.name, dtype=self.expression.dtype, qualifier=qualifier)

    def describe(self) -> str:
        rendered = self.expression.to_sql()
        if rendered == self.name:
            return rendered
        return f"{rendered} AS {self.name}"


@dataclass(frozen=True)
class SortItem:
    """One ORDER BY key with its direction and null placement."""

    expression: Expr
    descending: bool = False
    nulls_first: bool = False

    def describe(self) -> str:
        direction = "DESC" if self.descending else "ASC"
        nulls = "NULLS FIRST" if self.nulls_first else "NULLS LAST"
        return f"{self.expression.to_sql()} {direction} {nulls}"


class SetOpKind(Enum):
    UNION = "union"


class LogicalPlan:
    """Base class for logical plan nodes."""

    def children(self) -> Sequence["LogicalPlan"]:
        return ()

    def with_children(self, children: Sequence["LogicalPlan"]) -> "LogicalPlan":
        if children:
            raise PlanningError(f"{type(self).__name__} takes no children")
        return self

    @property
    def schema(self) -> Schema:  # pragma: no cover - overridden everywhere
        raise NotImplementedError

    @property
    def node_name(self) -> str:
        return type(self).__name__

    def describe(self) -> str:
        """One-line summary shown by EXPLAIN."""

        return self.node_name

    def expressions(self) -> Sequence[Expr]:
        """Expressions owned directly by this node (not by its children)."""

        return ()

    def walk(self) -> Iterator["LogicalPlan"]:
        yield self
        for child in self.children():
            yield from child.walk()

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return self.describe()


# ---------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scan(LogicalPlan):
    """Read a base table.

    ``projection`` holds the ordinals of the underlying table's columns that
    the scan should emit; ``None`` means "all columns".  ``pushed_filters``
    records predicates the optimizer moved into the scan so that EXPLAIN can
    show them and so that sources able to filter early can use them.
    """

    table: str
    alias: str
    table_schema: Schema
    projection: Optional[tuple[int, ...]] = None
    pushed_filters: tuple[Expr, ...] = ()

    @property
    def schema(self) -> Schema:
        qualified = self.table_schema.qualified(self.alias)
        if self.projection is None:
            return qualified
        return qualified.project(self.projection)

    @property
    def node_name(self) -> str:
        return "Scan"

    def expressions(self) -> Sequence[Expr]:
        return self.pushed_filters

    def with_projection(self, ordinals: Sequence[int]) -> "Scan":
        return replace(self, projection=tuple(ordinals))

    def with_filters(self, filters: Sequence[Expr]) -> "Scan":
        return replace(self, pushed_filters=tuple(filters))

    def describe(self) -> str:
        text = f"Scan {self.table}"
        if self.alias != self.table:
            text += f" AS {self.alias}"
        if self.projection is not None:
            names = ", ".join(self.schema.names)
            text += f" [{names}]"
        if self.pushed_filters:
            predicate = " AND ".join(f.to_sql() for f in self.pushed_filters)
            text += f" filter={predicate}"
        return text


@dataclass(frozen=True)
class OneRow(LogicalPlan):
    """A relation with no columns and exactly one row.

    ``SELECT 1`` with no FROM clause projects over this node, which keeps the
    planner free of special cases for source-less queries.
    """

    @property
    def schema(self) -> Schema:
        return Schema.empty()

    @property
    def node_name(self) -> str:
        return "OneRow"


@dataclass(frozen=True)
class EmptyRelation(LogicalPlan):
    """A relation with a known schema and no rows at all.

    Produced by the optimizer when a filter is provably unsatisfiable.
    """

    output_schema: Schema

    @property
    def schema(self) -> Schema:
        return self.output_schema

    @property
    def node_name(self) -> str:
        return "Empty"

    def describe(self) -> str:
        return f"Empty [{', '.join(self.output_schema.names)}]"


# ---------------------------------------------------------------------------
# Unary nodes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Filter(LogicalPlan):
    """Keep only rows for which ``predicate`` evaluates to TRUE."""

    input: LogicalPlan
    predicate: Expr

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)

    def expressions(self) -> Sequence[Expr]:
        return (self.predicate,)

    def describe(self) -> str:
        return f"Filter {self.predicate.to_sql()}"


@dataclass(frozen=True)
class Project(LogicalPlan):
    """Compute a new tuple shape from the input."""

    input: LogicalPlan
    projections: tuple[NamedExpr, ...]

    @property
    def schema(self) -> Schema:
        return Schema(item.to_field() for item in self.projections)

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)

    def expressions(self) -> Sequence[Expr]:
        return tuple(item.expression for item in self.projections)

    @property
    def is_identity(self) -> bool:
        """Whether this projection reproduces its input unchanged."""

        input_schema = self.input.schema
        if len(self.projections) != len(input_schema):
            return False
        for item, field_ in zip(self.projections, input_schema):
            expression = item.expression
            if not isinstance(expression, Column):
                return False
            if expression.name != field_.name or item.name != field_.name:
                return False
            if expression.qualifier != field_.qualifier:
                return False
        return True

    def describe(self) -> str:
        inner = ", ".join(item.describe() for item in self.projections)
        return f"Project [{inner}]"


@dataclass(frozen=True)
class Aggregate(LogicalPlan):
    """Group rows and compute aggregate functions over each group."""

    input: LogicalPlan
    group_by: tuple[NamedExpr, ...] = ()
    aggregates: tuple[NamedExpr, ...] = ()

    def __post_init__(self) -> None:
        for item in self.aggregates:
            if not isinstance(item.expression, AggregateCall):
                raise PlanningError(
                    "Aggregate node expects aggregate calls, got "
                    f"{type(item.expression).__name__}"
                )

    @property
    def schema(self) -> Schema:
        return Schema(
            item.to_field() for item in (*self.group_by, *self.aggregates)
        )

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)

    def expressions(self) -> Sequence[Expr]:
        return tuple(
            item.expression for item in (*self.group_by, *self.aggregates)
        )

    @property
    def is_global(self) -> bool:
        """Whether this is an ungrouped aggregate over the whole input."""

        return not self.group_by

    def describe(self) -> str:
        groups = ", ".join(item.describe() for item in self.group_by)
        aggs = ", ".join(item.describe() for item in self.aggregates)
        if groups:
            return f"Aggregate groups=[{groups}] aggs=[{aggs}]"
        return f"Aggregate aggs=[{aggs}]"


@dataclass(frozen=True)
class Sort(LogicalPlan):
    """Order rows by one or more keys."""

    input: LogicalPlan
    keys: tuple[SortItem, ...]

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)

    def expressions(self) -> Sequence[Expr]:
        return tuple(key.expression for key in self.keys)

    def describe(self) -> str:
        inner = ", ".join(key.describe() for key in self.keys)
        return f"Sort [{inner}]"


@dataclass(frozen=True)
class Limit(LogicalPlan):
    """Skip ``offset`` rows then emit at most ``count`` rows."""

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

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)

    @property
    def fetch_total(self) -> Optional[int]:
        """Rows the input must produce for this node to be satisfied."""

        if self.count is None:
            return None
        return self.count + self.offset

    def describe(self) -> str:
        parts = []
        if self.count is not None:
            parts.append(f"count={self.count}")
        if self.offset:
            parts.append(f"offset={self.offset}")
        return "Limit " + " ".join(parts) if parts else "Limit"


@dataclass(frozen=True)
class Distinct(LogicalPlan):
    """Remove duplicate rows."""

    input: LogicalPlan

    @property
    def schema(self) -> Schema:
        return self.input.schema

    def children(self) -> Sequence[LogicalPlan]:
        return (self.input,)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        (child,) = children
        return replace(self, input=child)


# ---------------------------------------------------------------------------
# Binary nodes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Join(LogicalPlan):
    """Combine two relations."""

    kind: JoinKind
    left: LogicalPlan
    right: LogicalPlan
    condition: Optional[Expr] = None

    def __post_init__(self) -> None:
        if self.kind is JoinKind.CROSS and self.condition is not None:
            raise PlanningError("CROSS JOIN must not carry a condition")

    @property
    def schema(self) -> Schema:
        left = self.left.schema
        right = self.right.schema
        if self.kind.keeps_right_nulls:
            left = left.with_nullable(True)
        if self.kind.keeps_left_nulls:
            right = right.with_nullable(True)
        return left.merge(right)

    def children(self) -> Sequence[LogicalPlan]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        left, right = children
        return replace(self, left=left, right=right)

    def expressions(self) -> Sequence[Expr]:
        return () if self.condition is None else (self.condition,)

    def describe(self) -> str:
        text = self.kind.sql()
        if self.condition is not None:
            text += f" ON {self.condition.to_sql()}"
        return text


@dataclass(frozen=True)
class SetOp(LogicalPlan):
    """A set operation between two union-compatible relations."""

    kind: SetOpKind
    left: LogicalPlan
    right: LogicalPlan
    all_rows: bool = False
    output_schema: Optional[Schema] = field(default=None)

    @property
    def schema(self) -> Schema:
        if self.output_schema is not None:
            return self.output_schema
        return self.left.schema

    def children(self) -> Sequence[LogicalPlan]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[LogicalPlan]) -> LogicalPlan:
        left, right = children
        return replace(self, left=left, right=right)

    def describe(self) -> str:
        suffix = " ALL" if self.all_rows else ""
        return f"{self.kind.value.title()}{suffix}"


def walk_plan(plan: LogicalPlan) -> Iterator[LogicalPlan]:
    """Yield ``plan`` and every descendant in pre-order."""

    return plan.walk()
