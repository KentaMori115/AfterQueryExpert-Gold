"""In-memory data sources.

:class:`MemorySource` wraps a :class:`~veldt.core.table.Table` that already
lives in memory. It is what :meth:`veldt.Engine.register_table` produces, what
tests use, and what the materialization cache stores.
"""

from __future__ import annotations

from typing import Any, Iterable, Iterator, List, Mapping, Optional, Sequence

from ..core.batch import RecordBatch
from ..core.table import DEFAULT_BATCH_SIZE, Table
from ..expr.ast import Expression
from ..plan.stats import ColumnStatistics, Statistics
from ..types.schema import Schema
from .base import DataSource

__all__ = ["MemorySource", "EmptySource"]


class MemorySource(DataSource):
    """A data source backed by an in-memory table."""

    def __init__(self, name: str, table: Table) -> None:
        self._name = name
        self._table = table

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_rows(
        cls, name: str, schema: Schema, rows: Iterable[Sequence[Any]]
    ) -> "MemorySource":
        """Build a source from row tuples."""
        return cls(name, Table.from_rows(schema, rows))

    @classmethod
    def from_dicts(
        cls,
        name: str,
        rows: Iterable[Mapping[str, Any]],
        schema: Optional[Schema] = None,
    ) -> "MemorySource":
        """Build a source from dictionaries, inferring a schema when absent."""
        return cls(name, Table.from_dicts(rows, schema))

    # ------------------------------------------------------------------
    # DataSource interface
    # ------------------------------------------------------------------
    @property
    def name(self) -> str:
        return self._name

    @property
    def schema(self) -> Schema:
        return self._table.schema

    @property
    def table(self) -> Table:
        """The underlying table."""
        return self._table

    def scan(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> Iterator[RecordBatch]:
        """Yield the table's batches, re-chunked to ``batch_size``."""
        target = self.projected_schema(projection)
        pending: List[RecordBatch] = []
        buffered = 0
        for batch in self._table.iter_batches():
            selected = batch if projection is None else batch.select(target.names)
            offset = 0
            while offset < selected.num_rows:
                take = min(batch_size - buffered, selected.num_rows - offset)
                pending.append(selected.slice(offset, take))
                buffered += take
                offset += take
                if buffered >= batch_size:
                    yield RecordBatch.concat(pending, target)
                    pending, buffered = [], 0
        if pending:
            yield RecordBatch.concat(pending, target)

    def statistics(self) -> Statistics:
        """Report exact row counts and per-column null and distinct counts."""
        columns = {}
        for field in self._table.schema:
            column = self._table.column(field.name)
            columns[field.name.lower()] = ColumnStatistics(
                null_count=column.null_count(),
                distinct_count=column.distinct_count(),
                min_value=column.min_value(),
                max_value=column.max_value(),
            )
        return Statistics(self._table.num_rows, columns)

    def __len__(self) -> int:
        return self._table.num_rows


class EmptySource(DataSource):
    """A source with a schema but no rows.

    Useful as a placeholder when a table is registered before its data is
    available, and as the identity element when concatenating sources.
    """

    def __init__(self, name: str, schema: Schema) -> None:
        self._name = name
        self._schema = schema

    @property
    def name(self) -> str:
        return self._name

    @property
    def schema(self) -> Schema:
        return self._schema

    def scan(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> Iterator[RecordBatch]:
        """Yield nothing at all."""
        self.projected_schema(projection)
        return iter(())

    def statistics(self) -> Statistics:
        return Statistics(0)
