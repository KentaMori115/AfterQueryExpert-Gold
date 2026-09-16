"""An in-memory table backed by Python lists."""

from __future__ import annotations

from typing import Any, Iterable, Iterator, Mapping, Optional, Sequence

from ...errors import StorageError
from ...types.schema import Field, Schema
from ...types.values import infer_column_type, normalise
from .base import DataSource

__all__ = ["MemorySource"]


class MemorySource(DataSource):
    """Holds rows in a list of lists.

    Rows are copied at construction time so that later mutation of the caller's
    data cannot change query results.
    """

    def __init__(
        self,
        schema: Schema,
        rows: Iterable[Sequence[Any]],
        *,
        label: str = "memory",
    ) -> None:
        self._schema = schema
        self._label = label
        width = len(schema)
        self._rows: list[list[Any]] = []
        for index, row in enumerate(rows):
            if len(row) != width:
                raise StorageError(
                    f"row {index} has {len(row)} values but the schema has {width} "
                    "columns"
                )
            self._rows.append([normalise(value) for value in row])

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def name(self) -> str:
        return self._label

    @property
    def rows(self) -> list[list[Any]]:
        """The stored rows.  Callers must treat the result as read-only."""

        return self._rows

    def row_count(self) -> Optional[int]:
        return len(self._rows)

    def scan(self, projection: Optional[Sequence[int]] = None) -> Iterator[list[Any]]:
        if projection is None:
            for row in self._rows:
                yield list(row)
            return
        indices = list(projection)
        for row in self._rows:
            yield [row[index] for index in indices]

    # -- convenience constructors ---------------------------------------

    @classmethod
    def from_dicts(
        cls,
        records: Iterable[Mapping[str, Any]],
        *,
        schema: Optional[Schema] = None,
        label: str = "memory",
    ) -> "MemorySource":
        """Build a source from dictionaries, inferring a schema if needed.

        Column order follows first appearance across the records, so two
        records with different key orders still produce a stable schema.
        """

        materialized = [dict(record) for record in records]
        if schema is None:
            names: list[str] = []
            for record in materialized:
                for key in record:
                    if key not in names:
                        names.append(key)
            fields = [
                Field(
                    name=name,
                    dtype=infer_column_type(record.get(name) for record in materialized),
                )
                for name in names
            ]
            schema = Schema(fields)
        rows = [[record.get(field.name) for field in schema] for record in materialized]
        return cls(schema, rows, label=label)

    @classmethod
    def from_columns(
        cls,
        columns: Mapping[str, Sequence[Any]],
        *,
        label: str = "memory",
    ) -> "MemorySource":
        """Build a source from a column-oriented mapping."""

        names = list(columns)
        if not names:
            return cls(Schema.empty(), [], label=label)
        lengths = {len(columns[name]) for name in names}
        if len(lengths) != 1:
            raise StorageError("all columns must have the same length")
        height = lengths.pop()
        schema = Schema(
            Field(name=name, dtype=infer_column_type(columns[name])) for name in names
        )
        rows = [[columns[name][index] for name in names] for index in range(height)]
        return cls(schema, rows, label=label)

    def with_rows(self, rows: Iterable[Sequence[Any]]) -> "MemorySource":
        """Return a new source with the same schema and different rows."""

        return MemorySource(self._schema, rows, label=self._label)
