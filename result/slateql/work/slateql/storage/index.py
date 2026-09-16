"""Simple in-memory indexes.

An index is built explicitly, over the rows a table holds at the time, and it
keeps those rows so that a later lookup can hand them back without reading the
source again.  Two shapes ship in the box: a hash index, which answers
equality, ``IN`` and ``IS NULL``, and a sorted index, which answers equality
and ``IN``, scans ranges, and can walk its rows in key order.

Both report *offsets* into the rows they were built from, and they report them
in whatever order the index itself found them, which is not the order the
table stores them in.  A caller that cares about row order sorts the offsets
before fetching, which is cheap because an offset is an integer.
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
    kind: str = "hash"


class _RowStore:
    """Row storage shared by both index shapes.

    Rows are copied at build time.  An index is a snapshot: it answers from
    what it saw, so a query it serves reads exactly the rows it fetches and
    nothing else.
    """

    __slots__ = ()

    def _store(self, rows: Iterable[Sequence[Any]]) -> list[list[Any]]:
        return [list(row) for row in rows]

    def rows_at(self, offsets: Iterable[int]) -> list[list[Any]]:
        """The rows at ``offsets``, copied, in the order the offsets came."""

        stored = self._rows  # type: ignore[attr-defined]
        return [list(stored[offset]) for offset in offsets]


class HashIndex(_RowStore):
    """Maps each distinct key to the row offsets holding it."""

    __slots__ = ("_column", "_ordinal", "_buckets", "_null_rows", "_size", "_rows")

    #: How ``SHOW INDEXES`` names this shape.
    kind = "hash"

    def __init__(self, schema: Schema, column: str) -> None:
        self._column = column
        self._ordinal = schema.index_of(column)
        self._buckets: dict[Any, list[int]] = {}
        self._null_rows: list[int] = []
        self._size = 0
        self._rows: list[list[Any]] = []

    @property
    def column(self) -> str:
        return self._column

    def build(self, rows: Iterable[Sequence[Any]]) -> "HashIndex":
        """Populate the index from ``rows``, discarding any previous content."""

        self._buckets.clear()
        self._null_rows.clear()
        self._size = 0
        self._rows = self._store(rows)
        for offset, row in enumerate(self._rows):
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

    def lookup_any(self, keys: Iterable[Any]) -> list[int]:
        """Row offsets matching any of ``keys``, each offset reported once.

        Keys are looked up one at a time, so the offsets arrive grouped by key
        and a repeated key would otherwise repeat its rows.
        """

        seen: set[int] = set()
        out: list[int] = []
        for key in keys:
            for offset in self.lookup(key):
                if offset not in seen:
                    seen.add(offset)
                    out.append(offset)
        return out

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
            kind=self.kind,
        )

    def __len__(self) -> int:
        return self._size

    def __iter__(self) -> Iterator[Any]:
        return iter(self._buckets)


class SortedIndex(_RowStore):
    """Keeps row offsets ordered by key so that range scans are cheap."""

    __slots__ = ("_column", "_ordinal", "_entries", "_null_rows", "_size", "_rows")

    #: How ``SHOW INDEXES`` names this shape.
    kind = "sorted"

    def __init__(self, schema: Schema, column: str) -> None:
        self._column = column
        self._ordinal = schema.index_of(column)
        self._entries: list[tuple[Any, int]] = []
        self._null_rows: list[int] = []
        self._size = 0
        self._rows: list[list[Any]] = []

    @property
    def column(self) -> str:
        return self._column

    def build(self, rows: Iterable[Sequence[Any]]) -> "SortedIndex":
        self._rows = self._store(rows)
        self._size = len(self._rows)
        self._null_rows = [
            offset
            for offset, row in enumerate(self._rows)
            if row[self._ordinal] is None
        ]
        entries = [
            (row[self._ordinal], offset)
            for offset, row in enumerate(self._rows)
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

    def equal(self, key: Any) -> list[int]:
        """Row offsets whose key equals ``key``.  NULL never matches."""

        if key is None:
            return []
        return [
            offset
            for entry_key, offset in self._entries
            if compare_values(entry_key, key) == 0
        ]

    def equal_any(self, keys: Iterable[Any]) -> list[int]:
        """Row offsets matching any of ``keys``, each offset reported once."""

        seen: set[int] = set()
        out: list[int] = []
        for key in keys:
            for offset in self.equal(key):
                if offset not in seen:
                    seen.add(offset)
                    out.append(offset)
        return out

    def in_key_order(
        self, *, descending: bool = False, nulls_first: bool = False
    ) -> list[int]:
        """Every row offset, ordered by key.

        Entries are held ascending by key and, within one key, by offset.
        Descending reverses the *keys* only: rows sharing a key keep the order
        the table gave them, which is what makes a sort on this column stable.
        Rows whose key is null are not in the entry list at all, so they go
        back in at whichever end the caller asks for.
        """

        ordered: list[int] = []
        if descending:
            groups: list[list[int]] = []
            previous: Any = None
            for key, offset in self._entries:
                if not groups or compare_values(key, previous) != 0:
                    groups.append([])
                    previous = key
                groups[-1].append(offset)
            for group in reversed(groups):
                ordered.extend(group)
        else:
            ordered = [offset for _, offset in self._entries]
        nulls = list(self._null_rows)
        return nulls + ordered if nulls_first else ordered + nulls

    def null_offsets(self) -> list[int]:
        return list(self._null_rows)

    def stats(self) -> IndexStats:
        keys: list[Any] = []
        for key, _ in self._entries:
            if not keys or compare_values(key, keys[-1]) != 0:
                keys.append(key)
        return IndexStats(
            column=self._column,
            entries=self._size,
            distinct_keys=len(keys),
            has_nulls=bool(self._null_rows),
            kind=self.kind,
        )

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
