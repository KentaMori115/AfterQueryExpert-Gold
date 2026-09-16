"""Value-level helpers: null handling, comparison and display.

Comparison deserves its own module because SQL semantics differ from Python's
in two ways the engine relies on everywhere:

* Any comparison involving ``NULL`` yields ``NULL``, not ``False``.
* Ordering must place nulls deterministically rather than raising ``TypeError``
  when a column mixes ``None`` with real values.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional, Sequence, Tuple

from .dtypes import DataType, infer_dtype

__all__ = [
    "is_null",
    "not_null",
    "null_count",
    "compare_values",
    "values_equal",
    "sort_key",
    "format_value",
    "coerce_bool",
    "TRUE_LITERALS",
    "FALSE_LITERALS",
]

TRUE_LITERALS = frozenset({"true", "t", "yes", "y", "1"})
FALSE_LITERALS = frozenset({"false", "f", "no", "n", "0"})

# Rank used to order values of different types against each other. Mixed-type
# columns are unusual but must still sort deterministically.
_TYPE_RANK = {
    DataType.NULL: 0,
    DataType.BOOL: 1,
    DataType.INT64: 2,
    DataType.FLOAT64: 2,
    DataType.TIMESTAMP: 3,
    DataType.STRING: 4,
}


def is_null(value: Any) -> bool:
    """True when ``value`` is SQL ``NULL``.

    Float NaN counts as null, which keeps aggregate results sane when a CSV
    column contains a stray ``nan``.
    """
    if value is None:
        return True
    return isinstance(value, float) and value != value


def not_null(value: Any) -> bool:
    """Convenience inverse of :func:`is_null` for use as a predicate."""
    return not is_null(value)


def null_count(values: Sequence[Any]) -> int:
    """Return how many entries of ``values`` are null."""
    return sum(1 for value in values if is_null(value))


def values_equal(left: Any, right: Any) -> Optional[bool]:
    """Compare for equality under SQL semantics.

    Returns:
        ``None`` when either side is null, otherwise a boolean. Numeric values
        compare across ``int``/``float``; booleans only equal booleans.
    """
    if is_null(left) or is_null(right):
        return None
    if isinstance(left, bool) != isinstance(right, bool):
        return False
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return float(left) == float(right)
    if isinstance(left, datetime) and isinstance(right, datetime):
        return left == right
    if type(left) is not type(right):
        return False
    return bool(left == right)


def compare_values(left: Any, right: Any) -> Optional[int]:
    """Three-way comparison under SQL semantics.

    Returns:
        ``-1``, ``0`` or ``1`` when both operands are non-null, and ``None``
        when either is null.

    Raises:
        TypeError: If the two values are of unrelated, non-comparable types.
    """
    if is_null(left) or is_null(right):
        return None
    if isinstance(left, bool) and isinstance(right, bool):
        return _sign(int(left) - int(right))
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if isinstance(left, bool) or isinstance(right, bool):
            left, right = int(left), int(right)
        difference = float(left) - float(right)
        return _sign(difference)
    if isinstance(left, str) and isinstance(right, str):
        return -1 if left < right else (0 if left == right else 1)
    if isinstance(left, (datetime, date)) and isinstance(right, (datetime, date)):
        normalized_left = _as_datetime(left)
        normalized_right = _as_datetime(right)
        if normalized_left == normalized_right:
            return 0
        return -1 if normalized_left < normalized_right else 1
    raise TypeError(
        f"cannot compare {type(left).__name__} with {type(right).__name__}"
    )


def sort_key(value: Any, nulls_first: bool = True) -> Tuple[int, int, Any]:
    """Return a tuple usable as a ``sorted`` key for mixed-type columns.

    The first element positions nulls, the second groups by type rank, and the
    third carries the comparable payload.
    """
    if is_null(value):
        return (0 if nulls_first else 2, 0, 0)
    rank = _TYPE_RANK.get(infer_dtype(value), 5)
    if isinstance(value, bool):
        return (1, rank, int(value))
    if isinstance(value, (int, float)):
        return (1, rank, float(value))
    if isinstance(value, (datetime, date)):
        return (1, rank, _as_datetime(value).timestamp())
    return (1, rank, value)


def coerce_bool(value: Any) -> Optional[bool]:
    """Interpret ``value`` as a boolean for filter predicates.

    Returns ``None`` for nulls and for strings that are not recognised truth
    literals, so an unparseable value behaves like ``NULL`` rather than
    silently filtering rows in or out.
    """
    if is_null(value):
        return None
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
        return None
    return None


def format_value(value: Any, null_text: str = "NULL", float_digits: int = 6) -> str:
    """Render a value for display in the CLI or a plan dump."""
    if is_null(value):
        return null_text
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if value == int(value) and abs(value) < 1e16:
            return f"{value:.1f}"
        return f"{round(value, float_digits)}"
    if isinstance(value, datetime):
        if value.microsecond:
            return value.strftime("%Y-%m-%d %H:%M:%S.%f")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _sign(difference: float) -> int:
    """Map a numeric difference onto ``-1``, ``0`` or ``1``."""
    if difference < 0:
        return -1
    return 0 if difference == 0 else 1


def _as_datetime(value: Any) -> datetime:
    """Promote a plain ``date`` to a ``datetime`` at midnight."""
    if isinstance(value, datetime):
        return value
    return datetime(value.year, value.month, value.day)
