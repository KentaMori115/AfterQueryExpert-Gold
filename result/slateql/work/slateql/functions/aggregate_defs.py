"""Built-in aggregate functions and their accumulators.

Accumulators are plain mutable objects created once per group.  DISTINCT is
handled by the aggregate operator, which de-duplicates argument tuples before
calling :meth:`update`, so the accumulators below never see repeats.

Every accumulator must return a well-defined value for an empty group: COUNT
returns 0, everything else returns NULL.
"""

from __future__ import annotations

import math
from typing import Any, Optional, Sequence

from ..errors import ExecutionError
from ..types.coercion import require_numeric
from ..types.datatypes import (
    BOOLEAN,
    DOUBLE,
    INTEGER,
    NULL,
    STRING,
    DataType,
    TypeKind,
)
from ..util.ordering import compare_values
from .signature import AggregateFunctionDef, Arity, fixed_type

__all__ = [
    "register",
    "CountAccumulator",
    "SumAccumulator",
    "AvgAccumulator",
    "MinAccumulator",
    "MaxAccumulator",
    "BoolAndAccumulator",
    "BoolOrAccumulator",
    "StringAggAccumulator",
    "VarianceAccumulator",
]


class CountAccumulator:
    """Counts rows; ``COUNT(*)`` counts every row, ``COUNT(x)`` skips NULLs."""

    __slots__ = ("_count", "_star")

    def __init__(self, star: bool = False) -> None:
        self._count = 0
        self._star = star

    def update(self, values: Sequence[Any]) -> None:
        if self._star or not values:
            self._count += 1
            return
        if values[0] is not None:
            self._count += 1

    def result(self) -> int:
        return self._count


class SumAccumulator:
    """Adds non-null numeric values, returning NULL for an all-null group."""

    __slots__ = ("_total", "_seen", "_integral")

    def __init__(self, integral: bool = False) -> None:
        self._total: float = 0
        self._seen = False
        self._integral = integral

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        self._seen = True
        self._total += value

    def result(self) -> Optional[Any]:
        if not self._seen:
            return None
        if self._integral:
            return int(self._total)
        return self._total


class AvgAccumulator:
    """Arithmetic mean of non-null values."""

    __slots__ = ("_total", "_count")

    def __init__(self) -> None:
        self._total = 0.0
        self._count = 0

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        self._total += float(value)
        self._count += 1

    def result(self) -> Optional[float]:
        if self._count == 0:
            return None
        return self._total / self._count


class _ExtremeAccumulator:
    """Shared base for MIN and MAX."""

    __slots__ = ("_best", "_seen", "_sign")

    def __init__(self, sign: int) -> None:
        self._best: Any = None
        self._seen = False
        self._sign = sign

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        if not self._seen:
            self._best = value
            self._seen = True
            return
        if compare_values(value, self._best) * self._sign > 0:
            self._best = value

    def result(self) -> Any:
        return self._best if self._seen else None


class MinAccumulator(_ExtremeAccumulator):
    def __init__(self) -> None:
        super().__init__(sign=-1)


class MaxAccumulator(_ExtremeAccumulator):
    def __init__(self) -> None:
        super().__init__(sign=1)


class AnyValueAccumulator:
    """Returns the first non-null value seen, which makes plans deterministic
    only when the input order is itself deterministic -- exactly the guarantee
    the executor provides."""

    __slots__ = ("_value", "_seen")

    def __init__(self) -> None:
        self._value: Any = None
        self._seen = False

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None or self._seen:
            return
        self._value = value
        self._seen = True

    def result(self) -> Any:
        return self._value


class BoolAndAccumulator:
    """TRUE when every non-null input is TRUE."""

    __slots__ = ("_value", "_seen")

    def __init__(self) -> None:
        self._value = True
        self._seen = False

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        self._seen = True
        self._value = self._value and bool(value)

    def result(self) -> Optional[bool]:
        return self._value if self._seen else None


class BoolOrAccumulator:
    """TRUE when at least one non-null input is TRUE."""

    __slots__ = ("_value", "_seen")

    def __init__(self) -> None:
        self._value = False
        self._seen = False

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        self._seen = True
        self._value = self._value or bool(value)

    def result(self) -> Optional[bool]:
        return self._value if self._seen else None


class StringAggAccumulator:
    """Concatenates non-null values with a separator taken from argument two."""

    __slots__ = ("_parts", "_separator")

    def __init__(self, separator: str = ",") -> None:
        self._parts: list[str] = []
        self._separator = separator

    def update(self, values: Sequence[Any]) -> None:
        if not values or values[0] is None:
            return
        if len(values) > 1 and values[1] is not None:
            self._separator = str(values[1])
        self._parts.append(str(values[0]))

    def result(self) -> Optional[str]:
        if not self._parts:
            return None
        return self._separator.join(self._parts)


class VarianceAccumulator:
    """Population or sample variance, computed with Welford's algorithm."""

    __slots__ = ("_count", "_mean", "_m2", "_sample", "_stddev")

    def __init__(self, *, sample: bool = False, stddev: bool = False) -> None:
        self._count = 0
        self._mean = 0.0
        self._m2 = 0.0
        self._sample = sample
        self._stddev = stddev

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is None:
            return
        number = float(value)
        self._count += 1
        delta = number - self._mean
        self._mean += delta / self._count
        self._m2 += delta * (number - self._mean)

    def result(self) -> Optional[float]:
        divisor = self._count - 1 if self._sample else self._count
        if self._count == 0 or divisor <= 0:
            return None
        variance = self._m2 / divisor
        return math.sqrt(variance) if self._stddev else variance


def _count_type(args: Sequence[DataType]) -> DataType:
    return INTEGER.as_nullable(False)


def _sum_type(args: Sequence[DataType]) -> DataType:
    if not args or args[0].is_null:
        return NULL
    require_numeric(args[0], context="sum()")
    if args[0].kind is TypeKind.INTEGER:
        return INTEGER.as_nullable(True)
    return DOUBLE.as_nullable(True)


def _avg_type(args: Sequence[DataType]) -> DataType:
    if args:
        require_numeric(args[0], context="avg()")
    return DOUBLE.as_nullable(True)


def _extreme_type(args: Sequence[DataType]) -> DataType:
    if not args:
        return NULL
    dtype = args[0]
    if not (dtype.is_ordered or dtype.is_null):
        raise ExecutionError(f"cannot compute an extreme of {dtype}")
    return dtype.as_nullable(True)


def _passthrough_type(args: Sequence[DataType]) -> DataType:
    return args[0].as_nullable(True) if args else NULL


def register(registry: Any) -> None:
    """Add every aggregate function to ``registry``."""

    def aggregate(
        name: str,
        arity: Arity,
        resolver: Any,
        factory: Any,
        description: str,
        *aliases: str,
        supports_distinct: bool = True,
        accepts_star: bool = False,
    ) -> None:
        registry.register_aggregate(
            AggregateFunctionDef(
                name=name,
                arity=arity,
                resolve_type=resolver,
                factory=factory,
                description=description,
                supports_distinct=supports_distinct,
                accepts_star=accepts_star,
            ),
            *aliases,
        )

    aggregate(
        "count",
        Arity.between(0, 1),
        _count_type,
        lambda arg_types: CountAccumulator(star=not arg_types),
        "Number of rows or of non-null values",
        accepts_star=True,
    )
    aggregate(
        "sum",
        Arity.exactly(1),
        _sum_type,
        lambda arg_types: SumAccumulator(
            integral=bool(arg_types) and arg_types[0].kind is TypeKind.INTEGER
        ),
        "Total of non-null values",
    )
    aggregate("avg", Arity.exactly(1), _avg_type, lambda _: AvgAccumulator(), "Mean", "mean")
    aggregate("min", Arity.exactly(1), _extreme_type, lambda _: MinAccumulator(), "Smallest value")
    aggregate("max", Arity.exactly(1), _extreme_type, lambda _: MaxAccumulator(), "Largest value")
    aggregate(
        "any_value",
        Arity.exactly(1),
        _passthrough_type,
        lambda _: AnyValueAccumulator(),
        "First non-null value in input order",
        supports_distinct=False,
    )
    aggregate(
        "bool_and",
        Arity.exactly(1),
        fixed_type(BOOLEAN),
        lambda _: BoolAndAccumulator(),
        "TRUE when every value is TRUE",
        "every",
    )
    aggregate(
        "bool_or",
        Arity.exactly(1),
        fixed_type(BOOLEAN),
        lambda _: BoolOrAccumulator(),
        "TRUE when any value is TRUE",
    )
    aggregate(
        "string_agg",
        Arity.between(1, 2),
        fixed_type(STRING),
        lambda _: StringAggAccumulator(),
        "Concatenate values with a separator",
    )
    aggregate(
        "var_pop",
        Arity.exactly(1),
        _avg_type,
        lambda _: VarianceAccumulator(sample=False),
        "Population variance",
    )
    aggregate(
        "var_samp",
        Arity.exactly(1),
        _avg_type,
        lambda _: VarianceAccumulator(sample=True),
        "Sample variance",
    )
    aggregate(
        "stddev_pop",
        Arity.exactly(1),
        _avg_type,
        lambda _: VarianceAccumulator(sample=False, stddev=True),
        "Population standard deviation",
    )
    aggregate(
        "stddev_samp",
        Arity.exactly(1),
        _avg_type,
        lambda _: VarianceAccumulator(sample=True, stddev=True),
        "Sample standard deviation",
        "stddev",
    )
