"""Typed expression tree used by plans and by the executor.

Plan expressions differ from AST expressions in three ways:

* every node knows its :class:`~slateql.types.DataType`;
* column references have been checked against a schema (though they are still
  resolved by *name*, not by ordinal, so that optimizer rewrites which reorder
  columns stay correct);
* syntactic sugar such as ``BETWEEN`` has been desugared away.

Nodes are immutable.  Rewrites build new nodes through
:meth:`Expr.with_children`, which keeps every rule small and side-effect free.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Optional, Sequence

from ..types.datatypes import BOOLEAN, DataType
from ..util.text import quote_identifier

__all__ = [
    "Expr",
    "Literal",
    "Column",
    "UnaryExpr",
    "BinaryExpr",
    "ScalarFunction",
    "AggregateCall",
    "CastExpr",
    "CaseExpr",
    "CaseBranch",
    "InList",
    "IsNull",
    "LikeMatch",
    "TRUE",
    "FALSE",
    "columns_of",
    "aggregates_of",
    "contains_aggregate",
    "conjuncts",
    "combine_and",
    "replace_columns",
]


class Expr:
    """Base class for typed expressions."""

    #: Populated by subclasses.
    dtype: DataType

    def children(self) -> Sequence["Expr"]:
        return ()

    def with_children(self, children: Sequence["Expr"]) -> "Expr":
        """Return a copy of this node with new children."""

        if children:
            raise TypeError(f"{type(self).__name__} takes no children")
        return self

    @property
    def is_constant(self) -> bool:
        """Whether the node evaluates to the same value for every row."""

        return all(child.is_constant for child in self.children())

    @property
    def is_volatile(self) -> bool:
        """Whether evaluation may differ between two calls with equal inputs."""

        return any(child.is_volatile for child in self.children())

    def to_sql(self) -> str:  # pragma: no cover - overridden everywhere
        raise NotImplementedError

    def walk(self) -> Iterator["Expr"]:
        yield self
        for child in self.children():
            yield from child.walk()

    def transform(self, fn: Callable[["Expr"], "Expr"]) -> "Expr":
        """Bottom-up rewrite: children first, then ``fn`` on the new node."""

        children = [child.transform(fn) for child in self.children()]
        node = self if _same(children, self.children()) else self.with_children(children)
        return fn(node)

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return self.to_sql()


def _same(new: Sequence[Expr], old: Sequence[Expr]) -> bool:
    return len(new) == len(old) and all(a is b for a, b in zip(new, old))


@dataclass(frozen=True)
class Literal(Expr):
    """A constant."""

    value: Any
    dtype: DataType

    @property
    def is_constant(self) -> bool:
        return True

    @property
    def is_volatile(self) -> bool:
        return False

    def to_sql(self) -> str:
        if self.value is None:
            return "NULL"
        if isinstance(self.value, bool):
            return "TRUE" if self.value else "FALSE"
        if isinstance(self.value, (int, float)):
            return repr(self.value)
        return "'" + str(self.value).replace("'", "''") + "'"


@dataclass(frozen=True)
class Column(Expr):
    """A reference to a column of the operator's input."""

    name: str
    dtype: DataType
    qualifier: Optional[str] = None

    @property
    def qualified_name(self) -> str:
        return f"{self.qualifier}.{self.name}" if self.qualifier else self.name

    @property
    def is_constant(self) -> bool:
        return False

    def to_sql(self) -> str:
        if self.qualifier:
            return f"{quote_identifier(self.qualifier)}.{quote_identifier(self.name)}"
        return quote_identifier(self.name)


@dataclass(frozen=True)
class UnaryExpr(Expr):
    """``-x`` or ``NOT x``."""

    op: str
    operand: Expr
    dtype: DataType

    def children(self) -> Sequence[Expr]:
        return (self.operand,)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        (operand,) = children
        return UnaryExpr(op=self.op, operand=operand, dtype=self.dtype)

    def to_sql(self) -> str:
        if self.op == "NOT":
            return f"(NOT {self.operand.to_sql()})"
        return f"({self.op}{self.operand.to_sql()})"


@dataclass(frozen=True)
class BinaryExpr(Expr):
    """Arithmetic, comparison, or logical operator."""

    op: str
    left: Expr
    right: Expr
    dtype: DataType

    def children(self) -> Sequence[Expr]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        left, right = children
        return BinaryExpr(op=self.op, left=left, right=right, dtype=self.dtype)

    @property
    def is_comparison(self) -> bool:
        return self.op in ("=", "<>", "!=", "<", "<=", ">", ">=")

    @property
    def is_logical(self) -> bool:
        return self.op in ("AND", "OR")

    def to_sql(self) -> str:
        return f"({self.left.to_sql()} {self.op} {self.right.to_sql()})"


@dataclass(frozen=True)
class ScalarFunction(Expr):
    """A call to a registered scalar function."""

    name: str
    args: tuple[Expr, ...]
    dtype: DataType
    volatile: bool = False

    def children(self) -> Sequence[Expr]:
        return self.args

    def with_children(self, children: Sequence[Expr]) -> Expr:
        return ScalarFunction(
            name=self.name,
            args=tuple(children),
            dtype=self.dtype,
            volatile=self.volatile,
        )

    @property
    def is_volatile(self) -> bool:
        return self.volatile or any(arg.is_volatile for arg in self.args)

    @property
    def is_constant(self) -> bool:
        return not self.volatile and all(arg.is_constant for arg in self.args)

    def to_sql(self) -> str:
        inner = ", ".join(arg.to_sql() for arg in self.args)
        return f"{self.name.upper()}({inner})"


@dataclass(frozen=True)
class AggregateCall(Expr):
    """A call to an aggregate function.

    Aggregates never appear below an :class:`~slateql.plan.logical.Aggregate`
    node; the binder lifts them out of the select list and replaces them with
    :class:`Column` references to the aggregate's output.
    """

    name: str
    args: tuple[Expr, ...]
    dtype: DataType
    distinct: bool = False
    star: bool = False

    def children(self) -> Sequence[Expr]:
        return self.args

    def with_children(self, children: Sequence[Expr]) -> Expr:
        return AggregateCall(
            name=self.name,
            args=tuple(children),
            dtype=self.dtype,
            distinct=self.distinct,
            star=self.star,
        )

    @property
    def is_constant(self) -> bool:
        return False

    def output_name(self) -> str:
        """Stable name for this aggregate's output column."""

        if self.star:
            return f"{self.name}(*)"
        prefix = "distinct " if self.distinct else ""
        inner = ", ".join(arg.to_sql() for arg in self.args)
        return f"{self.name}({prefix}{inner})"

    def to_sql(self) -> str:
        if self.star:
            return f"{self.name.upper()}(*)"
        prefix = "DISTINCT " if self.distinct else ""
        inner = ", ".join(arg.to_sql() for arg in self.args)
        return f"{self.name.upper()}({prefix}{inner})"


@dataclass(frozen=True)
class CastExpr(Expr):
    """An explicit type conversion."""

    operand: Expr
    dtype: DataType

    def children(self) -> Sequence[Expr]:
        return (self.operand,)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        (operand,) = children
        return CastExpr(operand=operand, dtype=self.dtype)

    def to_sql(self) -> str:
        return f"CAST({self.operand.to_sql()} AS {self.dtype.name})"


@dataclass(frozen=True)
class CaseBranch:
    """One WHEN/THEN pair."""

    condition: Expr
    result: Expr


@dataclass(frozen=True)
class CaseExpr(Expr):
    """A searched CASE expression; simple CASE is desugared into this form."""

    branches: tuple[CaseBranch, ...]
    dtype: DataType
    default: Optional[Expr] = None

    def children(self) -> Sequence[Expr]:
        out: list[Expr] = []
        for branch in self.branches:
            out.append(branch.condition)
            out.append(branch.result)
        if self.default is not None:
            out.append(self.default)
        return tuple(out)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        items = list(children)
        default: Optional[Expr] = None
        if len(items) % 2 == 1:
            default = items.pop()
        branches = tuple(
            CaseBranch(condition=items[i], result=items[i + 1])
            for i in range(0, len(items), 2)
        )
        return CaseExpr(branches=branches, dtype=self.dtype, default=default)

    def to_sql(self) -> str:
        parts = ["CASE"]
        for branch in self.branches:
            parts.append(
                f"WHEN {branch.condition.to_sql()} THEN {branch.result.to_sql()}"
            )
        if self.default is not None:
            parts.append(f"ELSE {self.default.to_sql()}")
        parts.append("END")
        return " ".join(parts)


@dataclass(frozen=True)
class InList(Expr):
    """``operand IN (items...)`` with SQL's null-propagating semantics."""

    operand: Expr
    items: tuple[Expr, ...]
    dtype: DataType = field(default=BOOLEAN)
    negated: bool = False

    def children(self) -> Sequence[Expr]:
        return (self.operand, *self.items)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        operand, *items = children
        return InList(
            operand=operand,
            items=tuple(items),
            dtype=self.dtype,
            negated=self.negated,
        )

    def to_sql(self) -> str:
        inner = ", ".join(item.to_sql() for item in self.items)
        keyword = "NOT IN" if self.negated else "IN"
        return f"({self.operand.to_sql()} {keyword} ({inner}))"


@dataclass(frozen=True)
class IsNull(Expr):
    """``operand IS [NOT] NULL``; never returns NULL itself."""

    operand: Expr
    dtype: DataType = field(default=BOOLEAN)
    negated: bool = False

    def children(self) -> Sequence[Expr]:
        return (self.operand,)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        (operand,) = children
        return IsNull(operand=operand, dtype=self.dtype, negated=self.negated)

    def to_sql(self) -> str:
        keyword = "IS NOT NULL" if self.negated else "IS NULL"
        return f"({self.operand.to_sql()} {keyword})"


@dataclass(frozen=True)
class LikeMatch(Expr):
    """``operand LIKE pattern [ESCAPE ch]``."""

    operand: Expr
    pattern: Expr
    dtype: DataType = field(default=BOOLEAN)
    negated: bool = False
    escape: Optional[Expr] = None

    def children(self) -> Sequence[Expr]:
        if self.escape is None:
            return (self.operand, self.pattern)
        return (self.operand, self.pattern, self.escape)

    def with_children(self, children: Sequence[Expr]) -> Expr:
        items = list(children)
        escape = items[2] if len(items) > 2 else None
        return LikeMatch(
            operand=items[0],
            pattern=items[1],
            dtype=self.dtype,
            negated=self.negated,
            escape=escape,
        )

    def to_sql(self) -> str:
        keyword = "NOT LIKE" if self.negated else "LIKE"
        text = f"({self.operand.to_sql()} {keyword} {self.pattern.to_sql()}"
        if self.escape is not None:
            text += f" ESCAPE {self.escape.to_sql()}"
        return text + ")"


TRUE = Literal(value=True, dtype=BOOLEAN.as_nullable(False))
FALSE = Literal(value=False, dtype=BOOLEAN.as_nullable(False))


# ---------------------------------------------------------------------------
# Traversal helpers
# ---------------------------------------------------------------------------


def columns_of(expression: Expr) -> list[Column]:
    """Every :class:`Column` referenced anywhere in ``expression``."""

    return [node for node in expression.walk() if isinstance(node, Column)]


def aggregates_of(expression: Expr) -> list[AggregateCall]:
    """Every aggregate call in ``expression``, outermost first."""

    return [node for node in expression.walk() if isinstance(node, AggregateCall)]


def contains_aggregate(expression: Expr) -> bool:
    return any(isinstance(node, AggregateCall) for node in expression.walk())


def conjuncts(expression: Optional[Expr]) -> list[Expr]:
    """Split a predicate into its top-level AND operands."""

    if expression is None:
        return []
    if isinstance(expression, BinaryExpr) and expression.op == "AND":
        return conjuncts(expression.left) + conjuncts(expression.right)
    return [expression]


def combine_and(predicates: Sequence[Expr]) -> Optional[Expr]:
    """Rebuild a single predicate from a list of conjuncts."""

    remaining = [p for p in predicates if p is not None]
    if not remaining:
        return None
    result = remaining[0]
    for predicate in remaining[1:]:
        nullable = result.dtype.nullable or predicate.dtype.nullable
        result = BinaryExpr(
            op="AND",
            left=result,
            right=predicate,
            dtype=BOOLEAN.as_nullable(nullable),
        )
    return result


def replace_columns(expression: Expr, mapping: dict[str, Expr]) -> Expr:
    """Substitute column references by name using ``mapping``."""

    def _rewrite(node: Expr) -> Expr:
        if isinstance(node, Column):
            replacement = mapping.get(node.qualified_name)
            if replacement is None:
                replacement = mapping.get(node.name)
            if replacement is not None:
                return replacement
        return node

    return expression.transform(_rewrite)
