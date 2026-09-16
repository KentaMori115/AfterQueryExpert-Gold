"""Null-aware comparison and sort-key construction.

SQL ordering is not Python ordering: NULL is not comparable with anything, and
whether it sorts before or after real values is a per-item decision.  These
helpers turn an ORDER BY item into a key function that Python's stable
``list.sort`` can use directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional, Sequence

from ..errors import ExecutionError

__all__ = ["SortKey", "compare_values", "null_safe_key", "make_row_key"]


@dataclass(frozen=True)
class SortKey:
    """One ORDER BY item: which value to read and how to order it."""

    getter: Callable[[Sequence[Any]], Any]
    descending: bool = False
    nulls_first: bool = False

    def rank(self, row: Sequence[Any]) -> tuple[int, Any]:
        """Return a tuple that sorts ``row`` correctly under this key."""

        value = self.getter(row)
        if value is None:
            return (0 if self.nulls_first else 2, 0)
        return (1, _Reversed(value) if self.descending else value)


class _Reversed:
    """Wrapper inverting the natural ordering of the value it holds."""

    __slots__ = ("value",)

    def __init__(self, value: Any) -> None:
        self.value = value

    def __lt__(self, other: "_Reversed") -> bool:
        return _raw_compare(other.value, self.value) < 0

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, _Reversed):
            return NotImplemented
        return self.value == other.value

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"_Reversed({self.value!r})"


def _raw_compare(left: Any, right: Any) -> int:
    """Three-way comparison of two non-null values of compatible types."""

    if isinstance(left, bool) != isinstance(right, bool):
        left = int(left) if isinstance(left, bool) else left
        right = int(right) if isinstance(right, bool) else right
    try:
        if left < right:
            return -1
        if right < left:
            return 1
    except TypeError as exc:
        raise ExecutionError(
            f"cannot order values of type {type(left).__name__} and "
            f"{type(right).__name__}"
        ) from exc
    return 0


def compare_values(left: Any, right: Any, *, nulls_first: bool = False) -> int:
    """Compare two SQL values, ordering NULLs consistently.

    Returns a negative number, zero, or a positive number in the usual
    three-way convention.
    """

    if left is None and right is None:
        return 0
    if left is None:
        return -1 if nulls_first else 1
    if right is None:
        return 1 if nulls_first else -1
    return _raw_compare(left, right)


def null_safe_key(
    getter: Callable[[Sequence[Any]], Any],
    *,
    descending: bool = False,
    nulls_first: bool = False,
) -> Callable[[Sequence[Any]], tuple[int, Any]]:
    """Build a single-column key function honouring null placement."""

    key = SortKey(getter=getter, descending=descending, nulls_first=nulls_first)
    return key.rank


def make_row_key(keys: Sequence[SortKey]) -> Callable[[Sequence[Any]], tuple]:
    """Combine several :class:`SortKey` objects into one tuple key function."""

    if not keys:
        raise ValueError("at least one sort key is required")

    def _key(row: Sequence[Any]) -> tuple:
        return tuple(key.rank(row) for key in keys)

    return _key


def coalesce(*values: Any) -> Optional[Any]:
    """Return the first non-null argument, or ``None`` when all are null."""

    for value in values:
        if value is not None:
            return value
    return None
