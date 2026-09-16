"""Abstract syntax tree produced by the parser.

The AST is a faithful, untyped mirror of the query text: identifiers are still
strings, no catalog lookups have happened, and no expression has a type.  The
binder in :mod:`slateql.analyze` converts it into the typed plan expressions of
:mod:`slateql.plan`.

Every node exposes ``children()`` so that generic traversal helpers can walk an
arbitrary tree without knowing the concrete node types.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterator, Optional, Sequence

__all__ = [
    "Node",
    "Expression",
    "Literal",
    "ColumnRef",
    "UnaryOp",
    "BinaryOp",
    "FunctionCall",
    "Cast",
    "CaseExpr",
    "WhenClause",
    "InList",
    "Between",
    "IsNull",
    "LikeExpr",
    "Statement",
    "SelectStatement",
    "SetOperation",
    "SetOpKind",
    "ExplainStatement",
    "ShowStatement",
    "SelectItem",
    "Projection",
    "StarProjection",
    "TableRef",
    "NamedTable",
    "JoinClause",
    "JoinKind",
    "OrderByItem",
    "walk",
]


class Node:
    """Base class for every AST node."""

    def children(self) -> Sequence["Node"]:
        """Direct child nodes, in source order."""

        return ()

    def node_name(self) -> str:
        return type(self).__name__


# ---------------------------------------------------------------------------
# Expressions
# ---------------------------------------------------------------------------


class Expression(Node):
    """Marker base class for expression nodes."""


@dataclass(frozen=True)
class Literal(Expression):
    """A constant value written directly in the query."""

    value: Any
    raw: Optional[str] = None

    def children(self) -> Sequence[Node]:
        return ()


@dataclass(frozen=True)
class ColumnRef(Expression):
    """A possibly qualified column reference such as ``o.total``."""

    name: str
    qualifier: Optional[str] = None

    @property
    def parts(self) -> tuple[str, ...]:
        return (self.qualifier, self.name) if self.qualifier else (self.name,)

    def render(self) -> str:
        return ".".join(self.parts)


@dataclass(frozen=True)
class UnaryOp(Expression):
    """Prefix operator: ``-x``, ``+x`` or ``NOT x``."""

    op: str
    operand: Expression

    def children(self) -> Sequence[Node]:
        return (self.operand,)


@dataclass(frozen=True)
class BinaryOp(Expression):
    """Infix operator covering arithmetic, comparison and logic."""

    op: str
    left: Expression
    right: Expression

    def children(self) -> Sequence[Node]:
        return (self.left, self.right)


@dataclass(frozen=True)
class FunctionCall(Expression):
    """A scalar or aggregate call site.

    ``star`` is set for ``COUNT(*)``; ``distinct`` for ``COUNT(DISTINCT x)``.
    """

    name: str
    args: tuple[Expression, ...] = ()
    distinct: bool = False
    star: bool = False

    def children(self) -> Sequence[Node]:
        return self.args


@dataclass(frozen=True)
class Cast(Expression):
    """``CAST(expr AS type)``."""

    operand: Expression
    type_name: str

    def children(self) -> Sequence[Node]:
        return (self.operand,)


@dataclass(frozen=True)
class WhenClause(Node):
    """One ``WHEN condition THEN result`` arm of a CASE expression."""

    condition: Expression
    result: Expression

    def children(self) -> Sequence[Node]:
        return (self.condition, self.result)


@dataclass(frozen=True)
class CaseExpr(Expression):
    """``CASE [operand] WHEN ... THEN ... [ELSE ...] END``."""

    whens: tuple[WhenClause, ...]
    operand: Optional[Expression] = None
    default: Optional[Expression] = None

    def children(self) -> Sequence[Node]:
        out: list[Node] = []
        if self.operand is not None:
            out.append(self.operand)
        out.extend(self.whens)
        if self.default is not None:
            out.append(self.default)
        return out


@dataclass(frozen=True)
class InList(Expression):
    """``expr [NOT] IN (a, b, c)``."""

    operand: Expression
    items: tuple[Expression, ...]
    negated: bool = False

    def children(self) -> Sequence[Node]:
        return (self.operand, *self.items)


@dataclass(frozen=True)
class Between(Expression):
    """``expr [NOT] BETWEEN low AND high``."""

    operand: Expression
    low: Expression
    high: Expression
    negated: bool = False

    def children(self) -> Sequence[Node]:
        return (self.operand, self.low, self.high)


@dataclass(frozen=True)
class IsNull(Expression):
    """``expr IS [NOT] NULL``."""

    operand: Expression
    negated: bool = False

    def children(self) -> Sequence[Node]:
        return (self.operand,)


@dataclass(frozen=True)
class LikeExpr(Expression):
    """``expr [NOT] LIKE pattern [ESCAPE ch]``."""

    operand: Expression
    pattern: Expression
    negated: bool = False
    escape: Optional[Expression] = None

    def children(self) -> Sequence[Node]:
        out = [self.operand, self.pattern]
        if self.escape is not None:
            out.append(self.escape)
        return out


# ---------------------------------------------------------------------------
# Select list, table references, ordering
# ---------------------------------------------------------------------------


class SelectItem(Node):
    """Marker base class for entries of the select list."""


@dataclass(frozen=True)
class Projection(SelectItem):
    """A single projected expression with an optional alias."""

    expression: Expression
    alias: Optional[str] = None

    def children(self) -> Sequence[Node]:
        return (self.expression,)


@dataclass(frozen=True)
class StarProjection(SelectItem):
    """``*`` or ``alias.*``."""

    qualifier: Optional[str] = None


class TableRef(Node):
    """Marker base class for FROM-clause entries."""


@dataclass(frozen=True)
class NamedTable(TableRef):
    """A catalog table, optionally aliased."""

    name: str
    alias: Optional[str] = None

    @property
    def effective_alias(self) -> str:
        return self.alias or self.name


class JoinKind(Enum):
    INNER = "inner"
    LEFT = "left"
    RIGHT = "right"
    FULL = "full"
    CROSS = "cross"

    @property
    def keeps_left_nulls(self) -> bool:
        """Whether unmatched left rows survive this join."""

        return self in (JoinKind.LEFT, JoinKind.FULL)

    @property
    def keeps_right_nulls(self) -> bool:
        return self in (JoinKind.RIGHT, JoinKind.FULL)

    def sql(self) -> str:
        return {
            JoinKind.INNER: "INNER JOIN",
            JoinKind.LEFT: "LEFT JOIN",
            JoinKind.RIGHT: "RIGHT JOIN",
            JoinKind.FULL: "FULL JOIN",
            JoinKind.CROSS: "CROSS JOIN",
        }[self]


@dataclass(frozen=True)
class JoinClause(TableRef):
    """A join between two table references."""

    kind: JoinKind
    left: TableRef
    right: TableRef
    condition: Optional[Expression] = None
    using: tuple[str, ...] = ()

    def children(self) -> Sequence[Node]:
        out: list[Node] = [self.left, self.right]
        if self.condition is not None:
            out.append(self.condition)
        return out


@dataclass(frozen=True)
class OrderByItem(Node):
    """One ORDER BY entry with its direction and null placement."""

    expression: Expression
    descending: bool = False
    nulls_first: Optional[bool] = None

    def children(self) -> Sequence[Node]:
        return (self.expression,)


# ---------------------------------------------------------------------------
# Statements
# ---------------------------------------------------------------------------


class Statement(Node):
    """Marker base class for top-level statements."""


@dataclass(frozen=True)
class SelectStatement(Statement):
    """A single SELECT block."""

    projections: tuple[SelectItem, ...]
    source: Optional[TableRef] = None
    where: Optional[Expression] = None
    group_by: tuple[Expression, ...] = ()
    having: Optional[Expression] = None
    order_by: tuple[OrderByItem, ...] = ()
    limit: Optional[Expression] = None
    offset: Optional[Expression] = None
    distinct: bool = False

    def children(self) -> Sequence[Node]:
        out: list[Node] = list(self.projections)
        if self.source is not None:
            out.append(self.source)
        if self.where is not None:
            out.append(self.where)
        out.extend(self.group_by)
        if self.having is not None:
            out.append(self.having)
        out.extend(self.order_by)
        return out


class SetOpKind(Enum):
    UNION = "union"

    def sql(self, all_rows: bool) -> str:
        return f"{self.value.upper()}{' ALL' if all_rows else ''}"


@dataclass(frozen=True)
class SetOperation(Statement):
    """``left UNION [ALL] right``."""

    kind: SetOpKind
    left: Statement
    right: Statement
    all_rows: bool = False
    order_by: tuple[OrderByItem, ...] = ()
    limit: Optional[Expression] = None
    offset: Optional[Expression] = None

    def children(self) -> Sequence[Node]:
        return (self.left, self.right, *self.order_by)


@dataclass(frozen=True)
class ExplainStatement(Statement):
    """``EXPLAIN [VERBOSE] <statement>``."""

    statement: Statement
    verbose: bool = False

    def children(self) -> Sequence[Node]:
        return (self.statement,)


@dataclass(frozen=True)
class ShowStatement(Statement):
    """``SHOW TABLES`` and ``SHOW COLUMNS FROM t``."""

    target: str
    table: Optional[str] = None
    options: dict[str, Any] = field(default_factory=dict)


def walk(node: Node) -> Iterator[Node]:
    """Yield ``node`` and every descendant in pre-order."""

    yield node
    for child in node.children():
        yield from walk(child)
