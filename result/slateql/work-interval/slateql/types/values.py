"""Value-level helpers: literal parsing, casting, and null semantics."""

from __future__ import annotations

import datetime as dt
from typing import Any, Iterable, Optional, Sequence

from ..errors import ExecutionError
from .datatypes import (
    DOUBLE,
    STRING,
    TIMESTAMP,
    DataType,
    TypeKind,
    type_from_python,
)
from .interval import Interval, parse_interval

__all__ = [
    "cast_value",
    "infer_column_type",
    "is_truthy",
    "parse_bool",
    "parse_date",
    "parse_timestamp",
    "normalise",
    "value_signature",
]

_BOOL_TRUE = frozenset({"true", "t", "yes", "y", "1"})
_BOOL_FALSE = frozenset({"false", "f", "no", "n", "0"})


def parse_bool(text: str) -> Optional[bool]:
    """Parse a textual boolean, returning ``None`` when unrecognised."""

    lowered = text.strip().lower()
    if lowered in _BOOL_TRUE:
        return True
    if lowered in _BOOL_FALSE:
        return False
    return None


def parse_date(text: str) -> Optional[dt.date]:
    """Parse ``YYYY-MM-DD`` returning ``None`` when the text does not match."""

    try:
        return dt.date.fromisoformat(text.strip())
    except ValueError:
        return None


def parse_timestamp(text: str) -> Optional[dt.datetime]:
    """Parse an ISO-8601 timestamp, tolerating a trailing ``Z``."""

    candidate = text.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        return dt.datetime.fromisoformat(candidate)
    except ValueError:
        pass
    date = parse_date(candidate)
    if date is not None:
        return dt.datetime(date.year, date.month, date.day)
    return None


def is_truthy(value: Any) -> bool:
    """SQL three-valued truth: only ``True`` counts as true."""

    return value is True


def normalise(value: Any) -> Any:
    """Convert an incoming Python value into a canonical engine value.

    Integers stay integers, floats stay floats, everything else is passed
    through unchanged.  ``bytes`` are decoded as UTF-8 because CSV readers may
    hand us raw bytes, and a :class:`datetime.timedelta` becomes an
    :class:`~slateql.types.interval.Interval` so that every INTERVAL column
    holds one kind of value.
    """

    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, dt.timedelta):
        return Interval.from_timedelta(value)
    return value


def cast_value(value: Any, target: DataType, *, strict: bool = False) -> Any:
    """Convert ``value`` to ``target``.

    A conversion that cannot be performed yields ``None`` unless ``strict`` is
    set, in which case an :class:`ExecutionError` is raised.  NULL always casts
    to NULL regardless of the target type.
    """

    if value is None:
        return None
    kind = target.kind
    try:
        if kind is TypeKind.NULL:
            return None
        if kind is TypeKind.BOOLEAN:
            return _to_boolean(value)
        if kind is TypeKind.INTEGER:
            return _to_integer(value)
        if kind is TypeKind.DOUBLE:
            return _to_double(value)
        if kind is TypeKind.STRING:
            return _to_string(value)
        if kind is TypeKind.DATE:
            return _to_date(value)
        if kind is TypeKind.TIMESTAMP:
            return _to_timestamp(value)
        if kind is TypeKind.INTERVAL:
            return _to_interval(value)
    except (ValueError, TypeError, OverflowError) as exc:
        if strict:
            raise ExecutionError(
                f"cannot cast {value!r} to {target.name}"
            ) from exc
        return None
    if strict:
        raise ExecutionError(f"cannot cast {value!r} to {target.name}")
    return None


def _to_boolean(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return parse_bool(value)
    raise TypeError(type(value).__name__)


def _to_integer(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("non-finite float")
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text)
        except ValueError:
            return int(float(text))
    raise TypeError(type(value).__name__)


def _to_double(value: Any) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        return float(value.strip())
    raise TypeError(type(value).__name__)


def _to_string(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, float):
        return repr(value)
    return str(value)


def _to_date(value: Any) -> dt.date:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        parsed = parse_date(value)
        if parsed is None:
            stamp = parse_timestamp(value)
            if stamp is None:
                raise ValueError(value)
            return stamp.date()
        return parsed
    raise TypeError(type(value).__name__)


def _to_timestamp(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day)
    if isinstance(value, str):
        parsed = parse_timestamp(value)
        if parsed is None:
            raise ValueError(value)
        return parsed
    raise TypeError(type(value).__name__)


def _to_interval(value: Any) -> Interval:
    if isinstance(value, Interval):
        return value
    if isinstance(value, dt.timedelta):
        return Interval.from_timedelta(value)
    if isinstance(value, str):
        return parse_interval(value)
    raise TypeError(type(value).__name__)


def infer_column_type(values: Iterable[Any]) -> DataType:
    """Infer a column type from sample values.

    The widest observed type wins.  A column with only NULLs is typed as
    STRING, matching what CSV loaders do for empty columns, but keeps its
    nullable flag set.
    """

    kinds: set[TypeKind] = set()
    saw_null = False
    for value in values:
        if value is None:
            saw_null = True
            continue
        kinds.add(type_from_python(value).kind)
    if not kinds:
        return STRING.as_nullable(True)
    if len(kinds) == 1:
        only = next(iter(kinds))
        return DataType(only, nullable=saw_null)
    if kinds <= {TypeKind.INTEGER, TypeKind.DOUBLE}:
        return DOUBLE.as_nullable(saw_null)
    if kinds <= {TypeKind.DATE, TypeKind.TIMESTAMP}:
        return TIMESTAMP.as_nullable(saw_null)
    return STRING.as_nullable(saw_null)


def value_signature(values: Sequence[Any]) -> tuple:
    """Hashable representation of a row used by DISTINCT and hash joins.

    Floats that compare equal to an integer hash identically in Python, which
    is exactly the grouping semantics we want, so no special casing is needed
    beyond making the row a tuple.
    """

    return tuple(values)
