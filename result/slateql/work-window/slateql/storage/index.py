"""Simple in-memory indexes.

Indexes are built explicitly and are currently consulted only by callers that
ask for them directly; the planner does not yet consider them when choosing an
access path.  They are useful today for repeated point lookups from embedding
code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Optional, Sequence

from ..errors import StorageError
from ..types.schema import Schema
from ..util.ordering import compare_values

__all__ = ["HashIndex", "SortedIndex", "IndexStats"]


@dataclass(frozen=True)
class IndexStats:
    """Shape of an index, reported by ``SHOW INDEXES``."""

    column: str
    entries: int
    distinct_keys: int
    has_nulls: bool


class HashIndex:
    """Maps each distinct key to the row offsets holding it."""

    __slots__ = ("_column", "_ordinal", "_buckets", "_null_rows", "_size")

    def __init__(self, schema: Schema, column: str) -> None:
        self._column = column
        self._ordinal = schema.index_of(column)
        self._buckets: dict[Any, list[int]] = {}
        self._null_rows: list[int] = []
        self._size = 0

    @property
    def column(self) -> str:
        return self._column

    def build(self, rows: Iterable[Sequence[Any]]) -> "HashIndex":
        """Populate the index from ``rows``, discarding any previous content."""

        self._buckets.clear()
        self._null_rows.clear()
        self._size = 0
        for offset, row in enumerate(rows):
            value = row[self._ordinal]
            self._size += 1
            if value is None:
                self._null_rows.append(offset)
                continue
            try:
                self._buckets.setdefault(value, []).append(offset)
            except TypeError as exc:  # pragma: no cover - unhashable values
                raise StorageError(
                    f"cannot index column {self._column!r}: values are not hashable"
                ) from exc
        return self

    def lookup(self, key: Any) -> list[int]:
        """Row offsets whose key equals ``key``.  NULL never matches."""

        if key is None:
            return []
        return list(self._buckets.get(key, ()))

    def contains(self, key: Any) -> bool:
        return key is not None and key in self._buckets

    def null_offsets(self) -> list[int]:
        return list(self._null_rows)

    def stats(self) -> IndexStats:
        return IndexStats(
            column=self._column,
            entries=self._size,
            distinct_keys=len(self._buckets),
            has_nulls=bool(self._null_rows),
        )

    def __len__(self) -> int:
        return self._size

    def __iter__(self) -> Iterator[Any]:
        return iter(self._buckets)


class SortedIndex:
    """Keeps row offsets ordered by key so that range scans are cheap."""

    __slots__ = ("_column", "_ordinal", "_entries")

    def __init__(self, schema: Schema, column: str) -> None:
        self._column = column
        self._ordinal = schema.index_of(column)
        self._entries: list[tuple[Any, int]] = []

    def build(self, rows: Iterable[Sequence[Any]]) -> "SortedIndex":
        entries = [
            (row[self._ordinal], offset)
            for offset, row in enumerate(rows)
            if row[self._ordinal] is not None
        ]
        entries.sort(key=_SortableKey)
        self._entries = entries
        return self

    def range(
        self,
        low: Optional[Any] = None,
        high: Optional[Any] = None,
        *,
        include_low: bool = True,
        include_high: bool = True,
    ) -> list[int]:
        """Row offsets whose key falls inside the requested bounds."""

        out: list[int] = []
        for key, offset in self._entries:
            if low is not None:
                order = compare_values(key, low)
                if order < 0 or (order == 0 and not include_low):
                    continue
            if high is not None:
                order = compare_values(key, high)
                if order > 0 or (order == 0 and not include_high):
                    continue
            out.append(offset)
        return out

    def __len__(self) -> int:
        return len(self._entries)


class _SortableKey:
    """Adapter making heterogeneous keys sortable through ``compare_values``."""

    __slots__ = ("entry",)

    def __init__(self, entry: tuple[Any, int]) -> None:
        self.entry = entry

    def __lt__(self, other: "_SortableKey") -> bool:
        order = compare_values(self.entry[0], other.entry[0])
        if order != 0:
            return order < 0
        return self.entry[1] < other.entry[1]
