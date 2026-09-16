"""Implicit type coercion rules.

The rules are deliberately narrow: SlateQL widens INTEGER to DOUBLE, treats
DATE as assignable to TIMESTAMP, and lets NULL unify with anything.  Everything
else requires an explicit CAST.  Keeping the lattice small means query results
never depend on surprising silent conversions.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

from ..errors import TypeMismatchError
from .datatypes import (
    BOOLEAN,
    DOUBLE,
    INTEGER,
    INTERVAL,
    NULL,
    STRING,
    TIMESTAMP,
    DataType,
    TypeKind,
)

__all__ = [
    "can_implicitly_cast",
    "common_type",
    "unify",
    "require_numeric",
    "require_boolean",
    "require_comparable",
    "explicit_cast_allowed",
]

_IMPLICIT_WIDENING: dict[TypeKind, frozenset[TypeKind]] = {
    TypeKind.NULL: frozenset(TypeKind),
    TypeKind.BOOLEAN: frozenset({TypeKind.BOOLEAN}),
    TypeKind.INTEGER: frozenset({TypeKind.INTEGER, TypeKind.DOUBLE}),
    TypeKind.DOUBLE: frozenset({TypeKind.DOUBLE}),
    TypeKind.STRING: frozenset({TypeKind.STRING}),
    TypeKind.DATE: frozenset({TypeKind.DATE, TypeKind.TIMESTAMP}),
    TypeKind.TIMESTAMP: frozenset({TypeKind.TIMESTAMP}),
    TypeKind.INTERVAL: frozenset({TypeKind.INTERVAL}),
}

_EXPLICIT_CAST: dict[TypeKind, frozenset[TypeKind]] = {
    TypeKind.NULL: frozenset(TypeKind),
    TypeKind.BOOLEAN: frozenset(
        {TypeKind.BOOLEAN, TypeKind.INTEGER, TypeKind.DOUBLE, TypeKind.STRING}
    ),
    TypeKind.INTEGER: frozenset(
        {TypeKind.INTEGER, TypeKind.DOUBLE, TypeKind.STRING, TypeKind.BOOLEAN}
    ),
    TypeKind.DOUBLE: frozenset(
        {TypeKind.DOUBLE, TypeKind.INTEGER, TypeKind.STRING, TypeKind.BOOLEAN}
    ),
    TypeKind.STRING: frozenset(
        {
            TypeKind.STRING,
            TypeKind.INTEGER,
            TypeKind.DOUBLE,
            TypeKind.BOOLEAN,
            TypeKind.DATE,
            TypeKind.TIMESTAMP,
            TypeKind.INTERVAL,
        }
    ),
    TypeKind.DATE: frozenset({TypeKind.DATE, TypeKind.TIMESTAMP, TypeKind.STRING}),
    TypeKind.TIMESTAMP: frozenset({TypeKind.TIMESTAMP, TypeKind.DATE, TypeKind.STRING}),
    TypeKind.INTERVAL: frozenset({TypeKind.INTERVAL, TypeKind.STRING}),
}


def can_implicitly_cast(source: DataType, target: DataType) -> bool:
    """Whether ``source`` values may be used where ``target`` is expected."""

    return target.kind in _IMPLICIT_WIDENING[source.kind]


def explicit_cast_allowed(source: DataType, target: DataType) -> bool:
    """Whether ``CAST(source AS target)`` is a legal conversion."""

    return target.kind in _EXPLICIT_CAST[source.kind]


def common_type(left: DataType, right: DataType) -> Optional[DataType]:
    """Return the narrowest type both operands widen to, or ``None``.

    Nullability of the result is the disjunction of the inputs: if either side
    may be null, the unified value may be null.
    """

    nullable = left.nullable or right.nullable or left.is_null or right.is_null
    if left.is_null and right.is_null:
        return NULL
    if left.is_null:
        return right.as_nullable(True)
    if right.is_null:
        return left.as_nullable(True)
    if left.kind is right.kind:
        return DataType(left.kind, nullable)
    if can_implicitly_cast(left, right):
        return DataType(right.kind, nullable)
    if can_implicitly_cast(right, left):
        return DataType(left.kind, nullable)
    return None


def unify(types: Iterable[DataType], *, context: str = "expression") -> DataType:
    """Reduce ``types`` to a single common type or raise.

    Used for CASE branches, IN lists, and set operations, all of which require
    every input to agree on one output type.
    """

    items = list(types)
    if not items:
        return NULL
    result = items[0]
    for candidate in items[1:]:
        merged = common_type(result, candidate)
        if merged is None:
            raise TypeMismatchError(
                f"incompatible types in {context}: {result} and {candidate}",
                hint="add an explicit CAST to make both branches agree",
            )
        result = merged
    return result


def require_numeric(dtype: DataType, *, context: str) -> DataType:
    """Assert ``dtype`` is numeric (or NULL) and return it."""

    if dtype.is_null or dtype.is_numeric:
        return dtype
    raise TypeMismatchError(f"{context} requires a numeric operand, got {dtype}")


def require_boolean(dtype: DataType, *, context: str) -> DataType:
    """Assert ``dtype`` is boolean (or NULL) and return it."""

    if dtype.is_null or dtype.kind is TypeKind.BOOLEAN:
        return dtype
    raise TypeMismatchError(f"{context} requires a boolean operand, got {dtype}")


def require_comparable(left: DataType, right: DataType, *, context: str) -> DataType:
    """Assert the two operands can be compared and return their common type."""

    merged = common_type(left, right)
    if merged is None or not (merged.is_ordered or merged.is_null):
        raise TypeMismatchError(
            f"cannot compare {left} with {right} in {context}",
            hint="values must share a comparable type",
        )
    return merged


def result_of_arithmetic(op: str, left: DataType, right: DataType) -> DataType:
    """Type of an arithmetic expression under the widening rules."""

    if left.is_null or right.is_null:
        return NULL
    if op == "||":
        if left.kind is TypeKind.STRING and right.kind is TypeKind.STRING:
            return STRING.as_nullable(left.nullable or right.nullable)
        raise TypeMismatchError(f"|| requires string operands, got {left} and {right}")
    nullable = left.nullable or right.nullable
    temporal = _temporal_arithmetic(op, left, right, nullable)
    if temporal is not None:
        return temporal
    require_numeric(left, context=f"operator {op}")
    require_numeric(right, context=f"operator {op}")
    if op == "/":
        return DOUBLE.as_nullable(True)
    if TypeKind.DOUBLE in (left.kind, right.kind):
        return DOUBLE.as_nullable(nullable)
    return INTEGER.as_nullable(nullable)


def _temporal_arithmetic(
    op: str, left: DataType, right: DataType, nullable: bool
) -> Optional[DataType]:
    """Result type when an interval, a date or a timestamp takes part in ``op``.

    ``+`` and ``-`` between two intervals stay INTERVAL; a date or timestamp
    plus or minus an interval is a TIMESTAMP; a timestamp minus a timestamp
    (or a date, which widens) is an INTERVAL, while a date minus a date is a
    whole number of days.  ``*`` by a number in either order and ``/`` by a
    number scale an interval.  Returns ``None`` when neither operand is
    temporal, so the numeric rules apply.
    """

    lk, rk = left.kind, right.kind
    interval = TypeKind.INTERVAL
    if op in ("+", "-"):
        if lk is interval and rk is interval:
            return INTERVAL.as_nullable(nullable)
        if lk in _TEMPORAL_KINDS and rk is interval:
            return TIMESTAMP.as_nullable(nullable)
        if op == "+" and lk is interval and rk in _TEMPORAL_KINDS:
            return TIMESTAMP.as_nullable(nullable)
        if op == "-" and lk in _TEMPORAL_KINDS and rk in _TEMPORAL_KINDS:
            if lk is TypeKind.DATE and rk is TypeKind.DATE:
                return INTEGER.as_nullable(nullable)
            return INTERVAL.as_nullable(nullable)
    if op == "*":
        if lk is interval and right.is_numeric:
            return INTERVAL.as_nullable(nullable)
        if left.is_numeric and rk is interval:
            return INTERVAL.as_nullable(nullable)
    if op == "/" and lk is interval and right.is_numeric:
        return INTERVAL.as_nullable(True)
    if interval in (lk, rk) or (lk in _TEMPORAL_KINDS and rk in _TEMPORAL_KINDS):
        raise TypeMismatchError(
            f"operator {op} is not defined for {left} and {right}",
            hint="intervals add to dates and timestamps, and scale by numbers",
        )
    return None


_TEMPORAL_KINDS = frozenset({TypeKind.DATE, TypeKind.TIMESTAMP})


def boolean_result(operands: Sequence[DataType]) -> DataType:
    """Type of a predicate whose operands are ``operands``."""

    nullable = any(op.nullable or op.is_null for op in operands)
    return BOOLEAN.as_nullable(nullable)


def timestamp_or_date(dtype: DataType) -> DataType:
    """Normalise DATE to TIMESTAMP for functions that only accept the latter."""

    if dtype.kind is TypeKind.DATE:
        return TIMESTAMP.as_nullable(dtype.nullable)
    return dtype
