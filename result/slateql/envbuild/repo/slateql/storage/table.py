"""A registered table: a name, a data source, and cached statistics."""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence

from ..types.schema import Schema
from .sources.base import DataSource
from .stats import TableStatistics, compute_statistics

__all__ = ["Table"]

_DEFAULT_ROW_ESTIMATE = 1_000


class Table:
    """Couples a catalog name with the source that supplies its rows."""

    __slots__ = ("_name", "_source", "_statistics", "_estimated_rows")

    def __init__(self, name: str, source: DataSource) -> None:
        self._name = name
        self._source = source
        self._statistics: Optional[TableStatistics] = None
        self._estimated_rows: Optional[int] = None

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
