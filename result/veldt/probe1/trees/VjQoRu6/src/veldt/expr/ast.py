"""The expression tree.

Every node is a frozen dataclass, so expressions are hashable, comparable by
value, and safe to share between plan nodes. Rewrites never mutate: a rule
builds a new node with :meth:`Expression.with_children`.

The nodes deliberately know nothing about evaluation or type resolution. Those
live in :mod:`veldt.expr.evaluator` and :mod:`veldt.expr.resolver` so that a
new backend could walk the same tree differently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterator, List, Optional, Sequence, Tuple

from ..types.dtypes import DataType, parse_dtype
from ..types.value import format_value
from ..utils.text import quote_identifier, quote_literal

__all__ = [
    "Expression",
    "Literal",
    "ColumnRef",
    "Alias",
    "UnaryOp",
    "BinaryOp",
    "FunctionCall",
    "AggregateCall",
    "Cast",
    "IsNull",
    "InList",
    "Between",
    "CaseWhen",
    "ARITHMETIC_OPERATORS",
    "COMPARISON_OPERATORS",
    "LOGICAL_OPERATORS",
    "walk",
    "transform",
    "collect_columns",
    "collect_aggregates",
    "contains_aggregate",
    "output_name",
    "literal",
    "column",
]

ARITHMETIC_OPERATORS = frozenset({"+", "-", "*", "/", "%"})
COMPARISON_OPERATORS = frozenset({"=", "!=", "<", "<=", ">", ">="})
LOGICAL_OPERATORS = frozenset({"and", "or"})
STRING_OPERATORS = frozenset({"||", "like", "not like"})


class Expression:
    """Base class for every node in the expression tree."""

    __slots__ = ()

    def children(self) -> Tuple["Expression", ...]:
        """Return the direct child expressions."""
        return ()

    def with_children(self, children: Sequence["Expression"]) -> "Expression":
        """Return a copy of this node with new children.

        Raises:
            ValueError: If the wrong number of children is supplied.
        """
        if children:
            raise ValueError(f"{type(self).__name__} takes no children")
        return self

    def to_sql(self) -> str:
        """Render the expression as SQL text."""
        raise NotImplementedError

    def __str__(self) -> str:
        return self.to_sql()


@dataclass(frozen=True)
class Literal(Expression):
    """A constant value with an explicit type."""

    value: Any
    dtype: DataType = DataType.NULL

    def __post_init__(self) -> None:
        object.__setattr__(self, "dtype", parse_dtype(self.dtype))

    def to_sql(self) -> str:
        if self.value is None:
            return "NULL"
        if self.dtype == DataType.STRING:
            return quote_literal(str(self.value))
        if self.dtype == DataType.TIMESTAMP:
            return f"TIMESTAMP {quote_literal(format_value(self.value))}"
        return format_value(self.value)


@dataclass(frozen=True)
class ColumnRef(Expression):
    """A reference to an input column, optionally table-qualified."""

    name: str
    qualifier: Optional[str] = None

    @property
    def qualified_name(self) -> str:
        """``table.column`` when qualified, otherwise just the column name."""
        return f"{self.qualifier}.{self.name}" if self.qualifier else self.name

    def to_sql(self) -> str:
        rendered = quote_identifier(self.name)
        if self.qualifier:
            return f"{quote_identifier(self.qualifier)}.{rendered}"
        return rendered


@dataclass(frozen=True)
class Alias(Expression):
    """An expression renamed with ``AS``."""

    child: Expression
    name: str

    def children(self) -> Tuple[Expression, ...]:
        return (self.child,)

    def with_children(self, children: Sequence[Expression]) -> "Alias":
        _expect(children, 1, "Alias")
        return Alias(children[0], self.name)

    def to_sql(self) -> str:
        return f"{self.child.to_sql()} AS {quote_identifier(self.name)}"


@dataclass(frozen=True)
class UnaryOp(Expression):
    """Negation (``-``) or logical ``NOT``."""

    operator: str
    operand: Expression

    def __post_init__(self) -> None:
        object.__setattr__(self, "operator", self.operator.lower())
        if self.operator not in ("-", "+", "not"):
            raise ValueError(f"unknown unary operator {self.operator!r}")

    def children(self) -> Tuple[Expression, ...]:
        return (self.operand,)

    def with_children(self, children: Sequence[Expression]) -> "UnaryOp":
        _expect(children, 1, "UnaryOp")
        return UnaryOp(self.operator, children[0])

    def to_sql(self) -> str:
        if self.operator == "not":
            return f"(NOT {self.operand.to_sql()})"
        return f"({self.operator}{self.operand.to_sql()})"


@dataclass(frozen=True)
class BinaryOp(Expression):
    """An infix operator applied to two operands."""

    operator: str
    left: Expression
    right: Expression

    def __post_init__(self) -> None:
        object.__setattr__(self, "operator", self.operator.lower())
        known = ARITHMETIC_OPERATORS | COMPARISON_OPERATORS | LOGICAL_OPERATORS | STRING_OPERATORS
        if self.operator not in known:
            raise ValueError(f"unknown binary operator {self.operator!r}")

    @property
    def is_comparison(self) -> bool:
        """True for the six comparison operators."""
        return self.operator in COMPARISON_OPERATORS

    @property
    def is_logical(self) -> bool:
        """True for ``AND`` and ``OR``."""
        return self.operator in LOGICAL_OPERATORS

    @property
    def is_arithmetic(self) -> bool:
        """True for the five arithmetic operators."""
        return self.operator in ARITHMETIC_OPERATORS

    def children(self) -> Tuple[Expression, ...]:
        return (self.left, self.right)

    def with_children(self, children: Sequence[Expression]) -> "BinaryOp":
        _expect(children, 2, "BinaryOp")
        return BinaryOp(self.operator, children[0], children[1])

    def swap(self) -> "BinaryOp":
        """Return the operator with its operands exchanged.

        Comparison operators are flipped so the result stays equivalent;
        commutative operators keep their spelling.
        """
        flipped = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}
        operator = flipped.get(self.operator, self.operator)
        return BinaryOp(operator, self.right, self.left)

    def to_sql(self) -> str:
        symbol = self.operator.upper() if self.operator.isalpha() else self.operator
        if self.operator == "!=":
            symbol = "<>"
        return f"({self.left.to_sql()} {symbol} {self.right.to_sql()})"


@dataclass(frozen=True)
class FunctionCall(Expression):
    """A call to a registered scalar function."""

    name: str
    args: Tuple[Expression, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", self.name.lower())
        object.__setattr__(self, "args", tuple(self.args))

    def children(self) -> Tuple[Expression, ...]:
        return self.args

    def with_children(self, children: Sequence[Expression]) -> "FunctionCall":
        return FunctionCall(self.name, tuple(children))

    def to_sql(self) -> str:
        rendered = ", ".join(arg.to_sql() for arg in self.args)
        return f"{self.name}({rendered})"


@dataclass(frozen=True)
class AggregateCall(Expression):
    """A call to a registered aggregate function.

    ``COUNT(*)`` is represented as an aggregate named ``count`` with no
    arguments, which keeps the star out of the expression language.
    """

    name: str
    args: Tuple[Expression, ...] = ()
    distinct: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", self.name.lower())
        object.__setattr__(self, "args", tuple(self.args))

    @property
    def is_star(self) -> bool:
        """True for the argument-less ``COUNT(*)`` form."""
        return self.name == "count" and not self.args

    def children(self) -> Tuple[Expression, ...]:
        return self.args

    def with_children(self, children: Sequence[Expression]) -> "AggregateCall":
        return AggregateCall(self.name, tuple(children), self.distinct)

    def to_sql(self) -> str:
        if self.is_star:
            return "count(*)"
        prefix = "DISTINCT " if self.distinct else ""
        rendered = ", ".join(arg.to_sql() for arg in self.args)
        return f"{self.name}({prefix}{rendered})"


@dataclass(frozen=True)
class Cast(Expression):
    """An explicit ``CAST(x AS type)``."""

    child: Expression
    target: DataType

    def __post_init__(self) -> None:
        object.__setattr__(self, "target", parse_dtype(self.target))

    def children(self) -> Tuple[Expression, ...]:
        return (self.child,)

    def with_children(self, children: Sequence[Expression]) -> "Cast":
        _expect(children, 1, "Cast")
        return Cast(children[0], self.target)

    def to_sql(self) -> str:
        return f"CAST({self.child.to_sql()} AS {self.target})"


@dataclass(frozen=True)
class IsNull(Expression):
    """``x IS NULL`` or ``x IS NOT NULL``."""

    child: Expression
    negated: bool = False

    def children(self) -> Tuple[Expression, ...]:
        return (self.child,)

    def with_children(self, children: Sequence[Expression]) -> "IsNull":
        _expect(children, 1, "IsNull")
        return IsNull(children[0], self.negated)

    def to_sql(self) -> str:
        keyword = "IS NOT NULL" if self.negated else "IS NULL"
        return f"({self.child.to_sql()} {keyword})"


@dataclass(frozen=True)
class InList(Expression):
    """``x IN (a, b, c)`` or its negation."""

    child: Expression
    options: Tuple[Expression, ...] = ()
    negated: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "options", tuple(self.options))

    def children(self) -> Tuple[Expression, ...]:
        return (self.child,) + self.options

    def with_children(self, children: Sequence[Expression]) -> "InList":
        if not children:
            raise ValueError("InList needs at least the tested expression")
        return InList(children[0], tuple(children[1:]), self.negated)

    def to_sql(self) -> str:
        keyword = "NOT IN" if self.negated else "IN"
        rendered = ", ".join(option.to_sql() for option in self.options)
        return f"({self.child.to_sql()} {keyword} ({rendered}))"


@dataclass(frozen=True)
class Between(Expression):
    """``x BETWEEN low AND high``, inclusive at both ends."""

    child: Expression
    low: Expression
    high: Expression
    negated: bool = False

    def children(self) -> Tuple[Expression, ...]:
        return (self.child, self.low, self.high)

    def with_children(self, children: Sequence[Expression]) -> "Between":
        _expect(children, 3, "Between")
        return Between(children[0], children[1], children[2], self.negated)

    def expand(self) -> Expression:
        """Rewrite as an equivalent pair of comparisons."""
        lower = BinaryOp(">=", self.child, self.low)
        upper = BinaryOp("<=", self.child, self.high)
        combined = BinaryOp("and", lower, upper)
        return UnaryOp("not", combined) if self.negated else combined

    def to_sql(self) -> str:
        keyword = "NOT BETWEEN" if self.negated else "BETWEEN"
        return (
            f"({self.child.to_sql()} {keyword} "
            f"{self.low.to_sql()} AND {self.high.to_sql()})"
        )


@dataclass(frozen=True)
class CaseWhen(Expression):
    """``CASE WHEN c THEN r ... ELSE o END``."""

    branches: Tuple[Tuple[Expression, Expression], ...]
    otherwise: Optional[Expression] = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "branches", tuple((cond, result) for cond, result in self.branches)
        )
        if not self.branches:
            raise ValueError("CASE requires at least one WHEN branch")

    @property
    def conditions(self) -> Tuple[Expression, ...]:
        """The ``WHEN`` predicates in order."""
        return tuple(condition for condition, _ in self.branches)

    @property
    def results(self) -> Tuple[Expression, ...]:
        """The ``THEN`` values in order, followed by ``ELSE`` when present."""
        values = [result for _, result in self.branches]
        if self.otherwise is not None:
            values.append(self.otherwise)
        return tuple(values)

    def children(self) -> Tuple[Expression, ...]:
        flat: List[Expression] = []
        for condition, result in self.branches:
            flat.extend((condition, result))
        if self.otherwise is not None:
            flat.append(self.otherwise)
        return tuple(flat)

    def with_children(self, children: Sequence[Expression]) -> "CaseWhen":
        items = list(children)
        otherwise = None
        if len(items) % 2 == 1:
            otherwise = items.pop()
        branches = tuple(
            (items[index], items[index + 1]) for index in range(0, len(items), 2)
        )
        return CaseWhen(branches, otherwise)

    def to_sql(self) -> str:
        parts = ["CASE"]
        for condition, result in self.branches:
            parts.append(f"WHEN {condition.to_sql()} THEN {result.to_sql()}")
        if self.otherwise is not None:
            parts.append(f"ELSE {self.otherwise.to_sql()}")
        parts.append("END")
        return " ".join(parts)


# ----------------------------------------------------------------------
# Tree helpers
# ----------------------------------------------------------------------
def walk(expression: Expression) -> Iterator[Expression]:
    """Yield every node in the tree, parents before children."""
    yield expression
    for child in expression.children():
        yield from walk(child)


def transform(expression: Expression, rule: Callable[[Expression], Expression]) -> Expression:
    """Rewrite the tree bottom-up, applying ``rule`` to every node.

    Children are rewritten first, so a rule always sees already-simplified
    operands. The rule may return the node unchanged.
    """
    children = expression.children()
    if children:
        rewritten = [transform(child, rule) for child in children]
        if any(new is not old for new, old in zip(rewritten, children)):
            expression = expression.with_children(rewritten)
    return rule(expression)


def collect_columns(expression: Expression) -> List[ColumnRef]:
    """Return every distinct column reference in the tree, in first-seen order."""
    seen: set = set()
    found: List[ColumnRef] = []
    for node in walk(expression):
        if isinstance(node, ColumnRef):
            key = (node.qualifier, node.name.lower())
            if key not in seen:
                seen.add(key)
                found.append(node)
    return found


def collect_aggregates(expression: Expression) -> List[AggregateCall]:
    """Return every aggregate call in the tree, in first-seen order."""
    found: List[AggregateCall] = []
    for node in walk(expression):
        if isinstance(node, AggregateCall) and node not in found:
            found.append(node)
    return found


def contains_aggregate(expression: Expression) -> bool:
    """True when the tree contains at least one aggregate call."""
    return any(isinstance(node, AggregateCall) for node in walk(expression))


def output_name(expression: Expression) -> str:
    """Derive the column name an expression produces.

    An alias wins outright; a bare column keeps its own name; anything else
    falls back to its SQL text, which is what most databases do.
    """
    if isinstance(expression, Alias):
        return expression.name
    if isinstance(expression, ColumnRef):
        return expression.name
    return expression.to_sql()


def literal(value: Any) -> Literal:
    """Build a :class:`Literal` with its type inferred from ``value``."""
    from ..types.dtypes import infer_dtype

    return Literal(value, infer_dtype(value))


def column(name: str, qualifier: Optional[str] = None) -> ColumnRef:
    """Build a :class:`ColumnRef`."""
    return ColumnRef(name, qualifier)


def _expect(children: Sequence[Expression], count: int, node: str) -> None:
    """Raise when a rewrite supplies the wrong number of children."""
    if len(children) != count:
        raise ValueError(f"{node} expects {count} children, got {len(children)}")
