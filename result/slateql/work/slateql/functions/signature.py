"""Function definitions and arity/type checking.

A function definition owns three responsibilities: describing how many
arguments it accepts, computing its return type from the argument types, and
evaluating itself on concrete values.  Splitting type resolution from
evaluation lets the binder type-check a query without touching data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol, Sequence

from ..errors import TypeMismatchError, UnknownFunctionError
from ..types.datatypes import NULL, DataType

__all__ = [
    "Arity",
    "ScalarFunctionDef",
    "AggregateFunctionDef",
    "Accumulator",
    "TypeResolver",
    "fixed_type",
    "same_as_argument",
]

TypeResolver = Callable[[Sequence[DataType]], DataType]


@dataclass(frozen=True)
class Arity:
    """The number of arguments a function accepts."""

    minimum: int
    maximum: Optional[int] = None

    @classmethod
    def exactly(cls, count: int) -> "Arity":
        return cls(minimum=count, maximum=count)

    @classmethod
    def at_least(cls, count: int) -> "Arity":
        return cls(minimum=count, maximum=None)

    @classmethod
    def between(cls, low: int, high: int) -> "Arity":
        return cls(minimum=low, maximum=high)

    def accepts(self, count: int) -> bool:
        if count < self.minimum:
            return False
        return self.maximum is None or count <= self.maximum

    def describe(self) -> str:
        if self.maximum is None:
            return f"at least {self.minimum}"
        if self.maximum == self.minimum:
            return f"exactly {self.minimum}"
        return f"between {self.minimum} and {self.maximum}"


def fixed_type(dtype: DataType) -> TypeResolver:
    """Return a resolver that always yields ``dtype``.

    Nullability is widened when any argument is nullable, because a function
    over a nullable input can generally produce NULL.
    """

    def _resolve(args: Sequence[DataType]) -> DataType:
        nullable = any(arg.nullable or arg.is_null for arg in args) or not args
        return dtype.as_nullable(nullable or dtype.nullable)

    return _resolve


def same_as_argument(index: int = 0) -> TypeResolver:
    """Return a resolver echoing the type of argument ``index``."""

    def _resolve(args: Sequence[DataType]) -> DataType:
        if index >= len(args):
            return NULL
        return args[index]

    return _resolve


class Accumulator(Protocol):
    """Runtime state of an aggregate over one group."""

    def update(self, values: Sequence[Any]) -> None:
        """Fold one input row's argument values into the running state."""

    def result(self) -> Any:
        """Return the aggregate's final value for the group."""


@dataclass(frozen=True)
class ScalarFunctionDef:
    """A scalar (row-at-a-time) function."""

    name: str
    arity: Arity
    resolve_type: TypeResolver
    evaluate: Callable[[Sequence[Any]], Any]
    volatile: bool = False
    propagates_null: bool = True
    description: str = ""

    def check_arity(self, count: int) -> None:
        if not self.arity.accepts(count):
            raise UnknownFunctionError(
                f"function {self.name}() takes {self.arity.describe()} arguments, "
                f"got {count}"
            )

    def return_type(self, arg_types: Sequence[DataType]) -> DataType:
        self.check_arity(len(arg_types))
        return self.resolve_type(arg_types)

    def call(self, values: Sequence[Any]) -> Any:
        """Evaluate with generic NULL propagation applied first."""

        if self.propagates_null and any(value is None for value in values):
            return None
        return self.evaluate(values)


@dataclass(frozen=True)
class AggregateFunctionDef:
    """An aggregate function together with its accumulator factory."""

    name: str
    arity: Arity
    resolve_type: TypeResolver
    factory: Callable[[Sequence[DataType]], Accumulator]
    supports_distinct: bool = True
    accepts_star: bool = False
    description: str = ""
    ignores_nulls: bool = True

    def check_arity(self, count: int) -> None:
        if not self.arity.accepts(count):
            raise UnknownFunctionError(
                f"aggregate {self.name}() takes {self.arity.describe()} arguments, "
                f"got {count}"
            )

    def return_type(self, arg_types: Sequence[DataType]) -> DataType:
        self.check_arity(len(arg_types))
        return self.resolve_type(arg_types)

    def create(self, arg_types: Sequence[DataType]) -> Accumulator:
        return self.factory(arg_types)

    def require_distinct_supported(self) -> None:
        if not self.supports_distinct:
            raise TypeMismatchError(
                f"aggregate {self.name}() does not support DISTINCT"
            )


@dataclass
class FunctionCatalogEntry:
    """Bookkeeping wrapper used when listing the registry contents."""

    name: str
    kind: str
    arity: str
    description: str = ""
    aliases: tuple[str, ...] = field(default_factory=tuple)
