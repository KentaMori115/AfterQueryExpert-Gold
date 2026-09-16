"""Conversion rules between the engine's types.

Two flavours of conversion exist:

``cast_value``
    The explicit ``CAST(x AS t)`` path. It is permissive about text (parsing
    numbers and timestamps out of strings) and raises :class:`CastError` when
    the value simply does not represent the target type.

``coerce_value``
    The implicit path used when a reader or literal already knows the intended
    type. It never parses text into a timestamp; it only widens.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional, Sequence

from ..errors import CastError
from ..utils.timeparse import format_timestamp, try_parse_timestamp
from .dtypes import DataType
from .value import FALSE_LITERALS, TRUE_LITERALS, is_null

__all__ = ["can_cast", "cast_value", "coerce_value", "cast_values", "try_cast_value"]

# Pairs that a cast is allowed to attempt. Anything not listed here fails fast
# during planning rather than row by row at execution time.
_CASTABLE = {
    (DataType.INT64, DataType.FLOAT64),
    (DataType.INT64, DataType.STRING),
    (DataType.INT64, DataType.BOOL),
    (DataType.INT64, DataType.TIMESTAMP),
    (DataType.FLOAT64, DataType.INT64),
    (DataType.FLOAT64, DataType.STRING),
    (DataType.FLOAT64, DataType.BOOL),
    (DataType.BOOL, DataType.INT64),
    (DataType.BOOL, DataType.FLOAT64),
    (DataType.BOOL, DataType.STRING),
    (DataType.STRING, DataType.INT64),
    (DataType.STRING, DataType.FLOAT64),
    (DataType.STRING, DataType.BOOL),
    (DataType.STRING, DataType.TIMESTAMP),
    (DataType.TIMESTAMP, DataType.STRING),
    (DataType.TIMESTAMP, DataType.INT64),
}


def can_cast(source: DataType, target: DataType) -> bool:
    """True when ``CAST`` from ``source`` to ``target`` is permitted."""
    if source == target:
        return True
    if source == DataType.NULL or target == DataType.NULL:
        return True
    return (source, target) in _CASTABLE


def cast_value(value: Any, target: DataType) -> Any:
    """Convert a single value to ``target``.

    Nulls pass through untouched regardless of the target type.

    Raises:
        CastError: If the value cannot be represented as ``target``.
    """
    if is_null(value):
        return None
    if target == DataType.NULL:
        raise CastError(value, str(target))
    if target == DataType.STRING:
        return _to_string(value)
    if target == DataType.INT64:
        return _to_int(value)
    if target == DataType.FLOAT64:
        return _to_float(value)
    if target == DataType.BOOL:
        return _to_bool(value)
    if target == DataType.TIMESTAMP:
        return _to_timestamp(value)
    raise CastError(value, str(target))


def try_cast_value(value: Any, target: DataType) -> Optional[Any]:
    """Like :func:`cast_value` but return ``None`` on failure."""
    try:
        return cast_value(value, target)
    except CastError:
        return None


def cast_values(values: Sequence[Any], target: DataType) -> List[Any]:
    """Cast every element of ``values`` to ``target``."""
    return [cast_value(value, target) for value in values]


def coerce_value(value: Any, target: DataType) -> Any:
    """Widen a value that is already close to ``target``.

    Unlike :func:`cast_value` this refuses to parse strings into numbers or
    timestamps: it only performs lossless widening such as ``int`` to
    ``float``. Anything else raises so that mislabelled data is caught at the
    boundary rather than corrupting results downstream.
    """
    if is_null(value):
        return None
    if target == DataType.FLOAT64 and isinstance(value, int) and not isinstance(value, bool):
        return float(value)
    if target == DataType.STRING and isinstance(value, str):
        return value
    if target == DataType.INT64 and isinstance(value, int) and not isinstance(value, bool):
        return value
    if target == DataType.FLOAT64 and isinstance(value, float):
        return value
    if target == DataType.BOOL and isinstance(value, bool):
        return value
    if target == DataType.TIMESTAMP and isinstance(value, datetime):
        return value
    if target == DataType.TIMESTAMP and isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    raise CastError(value, str(target))


def _to_string(value: Any) -> str:
    """Render a value as text using the engine's display rules."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (datetime, date)):
        return format_timestamp(value)
    if isinstance(value, float) and value == int(value) and abs(value) < 1e16:
        return str(int(value))
    return str(value)


def _to_int(value: Any) -> int:
    """Convert to ``int``, truncating floats towards zero."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text)
        except ValueError:
            pass
        try:
            return int(float(text))
        except ValueError:
            raise CastError(value, str(DataType.INT64)) from None
    raise CastError(value, str(DataType.INT64))


def _to_float(value: Any) -> float:
    """Convert to ``float``."""
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            raise CastError(value, str(DataType.FLOAT64)) from None
    raise CastError(value, str(DataType.FLOAT64))


def _to_bool(value: Any) -> bool:
    """Convert to ``bool``, accepting the usual textual spellings."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in TRUE_LITERALS:
            return True
        if lowered in FALSE_LITERALS:
            return False
    raise CastError(value, str(DataType.BOOL))


def _to_timestamp(value: Any) -> datetime:
    """Convert to ``datetime``, parsing text and epoch seconds."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, bool):
        raise CastError(value, str(DataType.TIMESTAMP))
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value))
    if isinstance(value, str):
        parsed = try_parse_timestamp(value)
        if parsed is None:
            raise CastError(value, str(DataType.TIMESTAMP))
        return parsed
    raise CastError(value, str(DataType.TIMESTAMP))
