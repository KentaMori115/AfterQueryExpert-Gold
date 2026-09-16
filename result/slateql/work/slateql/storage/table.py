"""A registered table: a name, a data source, cached statistics, and indexes."""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence, Union

from ..errors import ConfigurationError
from ..types.schema import Schema
from .index import HashIndex, IndexStats, SortedIndex
from .sources.base import DataSource
from .stats import TableStatistics, compute_statistics

__all__ = ["Table", "Index"]

#: Either index shape a table may carry.
Index = Union[HashIndex, SortedIndex]

_INDEX_KINDS = {"hash": HashIndex, "sorted": SortedIndex}

_DEFAULT_ROW_ESTIMATE = 1_000


class Table:
    """Couples a catalog name with the source that supplies its rows."""

    __slots__ = ("_name", "_source", "_statistics", "_estimated_rows", "_indexes")

    def __init__(self, name: str, source: DataSource) -> None:
        self._name = name
        self._source = source
        self._statistics: Optional[TableStatistics] = None
        self._estimated_rows: Optional[int] = None
        self._indexes: dict[str, Index] = {}

    @property
    def name(self) -> str:
        return self._name

    @property
    def source(self) -> DataSource:
        return self._source

    @property
    def schema(self) -> Schema:
        return self._source.schema

    def scan(self, projection: Optional[Sequence[int]] = None) -> Iterator[list[Any]]:
        """Read rows from the underlying source."""

        return self._source.scan(projection)

    # -- statistics ------------------------------------------------------

    @property
    def statistics(self) -> Optional[TableStatistics]:
        """Cached statistics, or ``None`` when ``analyze`` has not been run."""

        return self._statistics

    def analyze(self) -> TableStatistics:
        """Scan the table once and cache column statistics."""

        rows = list(self._source.scan())
        stats = compute_statistics(self.schema, rows)
        self._statistics = stats
        self._estimated_rows = stats.row_count
        return stats

    def invalidate_statistics(self) -> None:
        """Drop cached statistics, e.g. after the underlying file changed."""

        self._statistics = None
        self._estimated_rows = None

    # -- indexes ---------------------------------------------------------

    def create_index(self, column: str, kind: str = "hash") -> Index:
        """Build an index over ``column`` and keep it on this table.

        The column is resolved against the table schema first, so an unknown
        name fails the way a query naming it would.  Building a second index
        over a column that already has one replaces it: two indexes on one
        column would only ever disagree.
        """

        name = self.schema[self.schema.index_of(column)].name
        factory = _INDEX_KINDS.get(kind)
        if factory is None:
            raise ConfigurationError(
                f"unknown index kind: {kind!r}",
                hint="index kinds are 'hash' and 'sorted'",
            )
        index = factory(self.schema, name).build(self._source.scan())
        self._indexes[name] = index
        return index

    def drop_index(self, column: str) -> bool:
        """Remove the index on ``column``, reporting whether one was there."""

        name = self.schema[self.schema.index_of(column)].name
        return self._indexes.pop(name, None) is not None

    def index_for(self, column: str) -> Optional[Index]:
        """The index on ``column``, or ``None`` when it has none."""

        return self._indexes.get(column)

    def indexed_columns(self) -> list[str]:
        """Indexed column names, in the table's own schema order."""

        return [field.name for field in self.schema if field.name in self._indexes]

    def index_stats(self) -> list[IndexStats]:
        """One :class:`IndexStats` per index, in schema order."""

        return [self._indexes[name].stats() for name in self.indexed_columns()]

    def estimated_row_count(self) -> int:
        """Best available row-count estimate.

        Prefers real statistics, then a source that knows its own size, then a
        fixed fallback so that cost comparisons remain meaningful.
        """

        if self._statistics is not None:
            return self._statistics.row_count
        if self._estimated_rows is not None:
            return self._estimated_rows
        exact = self._source.row_count()
        if exact is not None:
            self._estimated_rows = exact
            return exact
        return _DEFAULT_ROW_ESTIMATE

    def describe(self) -> str:
        """Human readable summary used by ``SHOW COLUMNS``."""

        header = f"Table {self._name} ({self._source.name})"
        return f"{header}\n{self.schema.describe()}"

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Table({self._name!r}, columns={len(self.schema)})"
