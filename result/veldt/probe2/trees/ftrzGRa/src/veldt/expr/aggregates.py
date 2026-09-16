"""Aggregate functions and their accumulators.

An aggregate is split into two pieces:

:class:`Accumulator`
    Mutable state that consumes values one at a time and produces a final
    result. Accumulators also know how to :meth:`~Accumulator.merge` with
    another instance so partial aggregation can be combined.

:class:`AggregateFunction`
    The registry entry: a name, a factory for fresh accumulators, and a rule
    for the result type.

Every accumulator ignores nulls, which is what SQL requires: ``AVG`` divides by
the count of non-null values, and ``COUNT(x)`` counts only the rows where ``x``
is present. ``COUNT(*)`` is the sole exception and is handled by an accumulator
that counts rows regardless.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

from ..errors import FunctionNotFoundError, TypeMismatchError
from ..types.dtypes import DataType, is_numeric
from ..types.value import compare_values, is_null
from ..utils.hashing import value_key

__all__ = [
    "Accumulator",
    "AggregateFunction",
    "AggregateRegistry",
    "default_aggregate_registry",
]

ReturnTypeRule = Callable[[Sequence[DataType]], DataType]


class Accumulator:
    """Base class for aggregate state."""

    __slots__ = ()

    def update(self, value: Any) -> None:
        """Fold one value into the state."""
        raise NotImplementedError

    def update_many(self, values: Iterable[Any]) -> None:
        """Fold a sequence of values into the state."""
        for value in values:
            self.update(value)

    def merge(self, other: "Accumulator") -> None:
        """Absorb another accumulator of the same kind.

        Raises:
            TypeError: If the two accumulators are of different kinds.
        """
        raise NotImplementedError

    def finalize(self) -> Any:
        """Return the aggregate result."""
        raise NotImplementedError


class CountStar(Accumulator):
    """Counts every row, including all-null ones."""

    __slots__ = ("_count",)

    def __init__(self) -> None:
        self._count = 0

    def update(self, value: Any) -> None:
        self._count += 1

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        self._count += other._count

    def finalize(self) -> int:
        return self._count


class Count(Accumulator):
    """Counts non-null values."""

    __slots__ = ("_count",)

    def __init__(self) -> None:
        self._count = 0

    def update(self, value: Any) -> None:
        if not is_null(value):
            self._count += 1

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        self._count += other._count

    def finalize(self) -> int:
        return self._count


class CountDistinct(Accumulator):
    """Counts distinct non-null values using stable value keys."""

    __slots__ = ("_seen",)

    def __init__(self) -> None:
        self._seen: set = set()

    def update(self, value: Any) -> None:
        if not is_null(value):
            self._seen.add(value_key(value))

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        self._seen |= other._seen

    def finalize(self) -> int:
        return len(self._seen)


class Sum(Accumulator):
    """Adds non-null numeric values, returning null when none were seen."""

    __slots__ = ("_total", "_seen", "_is_float")

    def __init__(self, is_float: bool = False) -> None:
        self._total: float = 0.0 if is_float else 0
        self._seen = False
        self._is_float = is_float

    def update(self, value: Any) -> None:
        if is_null(value):
            return
        self._seen = True
        if isinstance(value, float):
            self._is_float = True
        self._total += value

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if other._seen:
            self._seen = True
            self._is_float = self._is_float or other._is_float
            self._total += other._total

    def finalize(self) -> Any:
        if not self._seen:
            return None
        return float(self._total) if self._is_float else self._total


class Average(Accumulator):
    """Mean of non-null numeric values."""

    __slots__ = ("_total", "_count")

    def __init__(self) -> None:
        self._total = 0.0
        self._count = 0

    def update(self, value: Any) -> None:
        if is_null(value):
            return
        self._total += float(value)
        self._count += 1

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        self._total += other._total
        self._count += other._count

    def finalize(self) -> Optional[float]:
        if self._count == 0:
            return None
        return self._total / self._count


class Extreme(Accumulator):
    """Shared implementation for ``MIN`` and ``MAX``."""

    __slots__ = ("_best", "_seen", "_largest")

    def __init__(self, largest: bool) -> None:
        self._best: Any = None
        self._seen = False
        self._largest = largest

    def update(self, value: Any) -> None:
        if is_null(value):
            return
        if not self._seen:
            self._best = value
            self._seen = True
            return
        order = compare_values(value, self._best)
        if order is None:
            return
        if (order > 0) if self._largest else (order < 0):
            self._best = value

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if other._seen:
            self.update(other._best)

    def finalize(self) -> Any:
        return self._best if self._seen else None


class Variance(Accumulator):
    """Welford's online variance, sample or population."""

    __slots__ = ("_count", "_mean", "_m2", "_sample", "_root")

    def __init__(self, sample: bool = True, root: bool = False) -> None:
        self._count = 0
        self._mean = 0.0
        self._m2 = 0.0
        self._sample = sample
        self._root = root

    def update(self, value: Any) -> None:
        if is_null(value):
            return
        number = float(value)
        self._count += 1
        delta = number - self._mean
        self._mean += delta / self._count
        self._m2 += delta * (number - self._mean)

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if other._count == 0:
            return
        if self._count == 0:
            self._count, self._mean, self._m2 = other._count, other._mean, other._m2
            return
        total = self._count + other._count
        delta = other._mean - self._mean
        self._mean += delta * other._count / total
        self._m2 += other._m2 + delta * delta * self._count * other._count / total
        self._count = total

    def finalize(self) -> Optional[float]:
        divisor = self._count - 1 if self._sample else self._count
        if divisor <= 0:
            return None
        result = self._m2 / divisor
        return math.sqrt(result) if self._root else result


class FirstValue(Accumulator):
    """Keeps the first non-null value seen."""

    __slots__ = ("_value", "_seen")

    def __init__(self) -> None:
        self._value: Any = None
        self._seen = False

    def update(self, value: Any) -> None:
        if not self._seen and not is_null(value):
            self._value = value
            self._seen = True

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if not self._seen and other._seen:
            self._value, self._seen = other._value, True

    def finalize(self) -> Any:
        return self._value


class LastValue(Accumulator):
    """Keeps the last non-null value seen."""

    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value: Any = None

    def update(self, value: Any) -> None:
        if not is_null(value):
            self._value = value

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if other._value is not None:
            self._value = other._value

    def finalize(self) -> Any:
        return self._value


class StringAgg(Accumulator):
    """Concatenates non-null values with a separator."""

    __slots__ = ("_parts", "_separator")

    def __init__(self, separator: str = ",") -> None:
        self._parts: List[str] = []
        self._separator = separator

    def update(self, value: Any) -> None:
        if not is_null(value):
            self._parts.append(str(value))

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        self._parts.extend(other._parts)

    def finalize(self) -> Optional[str]:
        return self._separator.join(self._parts) if self._parts else None


class BoolReduce(Accumulator):
    """Shared implementation for ``BOOL_AND`` and ``BOOL_OR``."""

    __slots__ = ("_result", "_seen", "_require_all")

    def __init__(self, require_all: bool) -> None:
        self._result = require_all
        self._seen = False
        self._require_all = require_all

    def update(self, value: Any) -> None:
        from ..types.value import coerce_bool

        truth = coerce_bool(value)
        if truth is None:
            return
        self._seen = True
        if self._require_all:
            self._result = self._result and truth
        else:
            self._result = self._result or truth

    def merge(self, other: "Accumulator") -> None:
        _require_same(self, other)
        if other._seen:
            self._seen = True
            if self._require_all:
                self._result = self._result and other._result
            else:
                self._result = self._result or other._result

    def finalize(self) -> Optional[bool]:
        return self._result if self._seen else None


@dataclass(frozen=True)
class AggregateFunction:
    """A registry entry describing one aggregate."""

    name: str
    factory: Callable[[Sequence[DataType]], Accumulator]
    return_type: DataType | ReturnTypeRule
    min_args: int = 1
    max_args: Optional[int] = 1
    doc: str = ""

    def accepts(self, count: int) -> bool:
        """True when ``count`` arguments satisfy this aggregate's arity."""
        if count < self.min_args:
            return False
        return self.max_args is None or count <= self.max_args

    def resolve_type(self, arg_types: Sequence[DataType]) -> DataType:
        """Compute the result type.

        Raises:
            TypeMismatchError: If the argument count is wrong.
        """
        if not self.accepts(len(arg_types)):
            expected = (
                str(self.min_args)
                if self.max_args == self.min_args
                else f"{self.min_args} to {self.max_args or 'many'}"
            )
            raise TypeMismatchError(
                f"{self.name}() takes {expected} arguments, got {len(arg_types)}",
                operator=self.name,
            )
        if callable(self.return_type):
            return self.return_type(list(arg_types))
        return self.return_type

    def create(self, arg_types: Sequence[DataType] = ()) -> Accumulator:
        """Build a fresh accumulator for the given argument types."""
        return self.factory(list(arg_types))


class AggregateRegistry:
    """A mutable, case-insensitive map of aggregate names."""

    def __init__(self, functions: Iterable[AggregateFunction] = ()) -> None:
        self._functions: Dict[str, AggregateFunction] = {}
        for function in functions:
            self.register(function)

    def register(self, function: AggregateFunction, replace: bool = False) -> "AggregateRegistry":
        """Add an aggregate, optionally replacing an existing name."""
        key = function.name.lower()
        if key in self._functions and not replace:
            raise ValueError(f"aggregate {function.name!r} is already registered")
        self._functions[key] = function
        return self

    def get(self, name: str) -> AggregateFunction:
        """Look up an aggregate.

        Raises:
            FunctionNotFoundError: If no aggregate has that name.
        """
        try:
            return self._functions[name.lower()]
        except KeyError:
            raise FunctionNotFoundError(name, self.names()) from None

    def has(self, name: str) -> bool:
        """True when an aggregate with this name is registered."""
        return name.lower() in self._functions

    def names(self) -> List[str]:
        """Registered names in alphabetical order."""
        return sorted(self._functions)

    def copy(self) -> "AggregateRegistry":
        """Return an independent copy that can be extended safely."""
        clone = AggregateRegistry()
        clone._functions = dict(self._functions)
        return clone

    def __len__(self) -> int:
        return len(self._functions)

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and self.has(name)


def _numeric_input(arg_types: Sequence[DataType], name: str) -> None:
    """Reject non-numeric arguments for arithmetic aggregates."""
    for dtype in arg_types:
        if dtype != DataType.NULL and not is_numeric(dtype):
            raise TypeMismatchError(f"{name}() requires a numeric argument, got {dtype}")


def _sum_type(arg_types: Sequence[DataType]) -> DataType:
    _numeric_input(arg_types, "sum")
    if not arg_types or arg_types[0] == DataType.NULL:
        return DataType.INT64
    return arg_types[0]


def _avg_type(arg_types: Sequence[DataType]) -> DataType:
    _numeric_input(arg_types, "avg")
    return DataType.FLOAT64


def _passthrough_type(arg_types: Sequence[DataType]) -> DataType:
    return arg_types[0] if arg_types else DataType.NULL


def default_aggregate_registry() -> AggregateRegistry:
    """Build a registry containing every built-in aggregate."""
    registry = AggregateRegistry()

    def add(
        name: str,
        factory: Callable[[Sequence[DataType]], Accumulator],
        return_type: DataType | ReturnTypeRule,
        min_args: int = 1,
        max_args: Optional[int] = 1,
        doc: str = "",
    ) -> None:
        registry.register(
            AggregateFunction(name, factory, return_type, min_args, max_args, doc)
        )

    add(
        "count",
        lambda types: CountStar() if not types else Count(),
        DataType.INT64,
        min_args=0,
        max_args=1,
        doc="Row count, or count of non-null values",
    )
    add(
        "sum",
        lambda types: Sum(bool(types) and types[0] == DataType.FLOAT64),
        _sum_type,
        doc="Sum of non-null values",
    )
    add("avg", lambda types: Average(), _avg_type, doc="Mean of non-null values")
    add("min", lambda types: Extreme(largest=False), _passthrough_type, doc="Smallest value")
    add("max", lambda types: Extreme(largest=True), _passthrough_type, doc="Largest value")
    add(
        "stddev",
        lambda types: Variance(sample=True, root=True),
        _avg_type,
        doc="Sample standard deviation",
    )
    add(
        "variance",
        lambda types: Variance(sample=True, root=False),
        _avg_type,
        doc="Sample variance",
    )
    add("first", lambda types: FirstValue(), _passthrough_type, doc="First non-null value")
    add("last", lambda types: LastValue(), _passthrough_type, doc="Last non-null value")
    add(
        "string_agg",
        lambda types: StringAgg(),
        DataType.STRING,
        min_args=1,
        max_args=2,
        doc="Concatenate values with commas",
    )
    add(
        "bool_and",
        lambda types: BoolReduce(require_all=True),
        DataType.BOOL,
        doc="True when every value is true",
    )
    add(
        "bool_or",
        lambda types: BoolReduce(require_all=False),
        DataType.BOOL,
        doc="True when any value is true",
    )
    return registry


def _require_same(left: Accumulator, right: Accumulator) -> None:
    """Raise when merging accumulators of different kinds."""
    if type(left) is not type(right):
        raise TypeError(
            f"cannot merge {type(left).__name__} with {type(right).__name__}"
        )
