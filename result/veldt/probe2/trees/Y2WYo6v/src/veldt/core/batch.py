"""Record batches: the unit of data that flows between operators.

A :class:`RecordBatch` is a schema plus one :class:`~veldt.core.column.Column`
per field, all of equal length. Operators consume batches and emit batches; no
operator ever sees the whole table at once unless it is a blocking operator
that explicitly buffers.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence

from ..errors import SchemaError
from ..types.dtypes import DataType
from ..types.schema import Field, Schema
from .column import Column

__all__ = ["RecordBatch"]


class RecordBatch:
    """An immutable, column-oriented chunk of rows."""

    __slots__ = ("_schema", "_columns", "_num_rows")

    def __init__(self, schema: Schema, columns: Sequence[Column]) -> None:
        if len(schema) != len(columns):
            raise SchemaError(
                f"batch has {len(columns)} columns but schema declares {len(schema)}"
            )
        lengths = {len(column) for column in columns}
        if len(lengths) > 1:
            raise SchemaError(f"batch columns have differing lengths: {sorted(lengths)}")
        for field, column in zip(schema, columns):
            if field.name != column.name:
                raise SchemaError(
                    f"column name mismatch: schema says {field.name!r}, "
                    f"column says {column.name!r}"
                )
        self._schema = schema
        self._columns: List[Column] = list(columns)
        self._num_rows = lengths.pop() if lengths else 0

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def empty(cls, schema: Schema) -> "RecordBatch":
        """Return a batch with the given schema and no rows."""
        return cls(schema, [Column(field.name, field.dtype, []) for field in schema])

    @classmethod
    def from_rows(cls, schema: Schema, rows: Iterable[Sequence[Any]]) -> "RecordBatch":
        """Build a batch from row tuples in schema order.

        Raises:
            SchemaError: If a row has the wrong number of values.
        """
        buffers: List[List[Any]] = [[] for _ in schema]
        for row in rows:
            if len(row) != len(schema):
                raise SchemaError(
                    f"row has {len(row)} values but schema declares {len(schema)}"
                )
            for index, value in enumerate(row):
                buffers[index].append(value)
        columns = [
            Column(field.name, field.dtype, buffer)
            for field, buffer in zip(schema, buffers)
        ]
        return cls(schema, columns)

    @classmethod
    def from_dicts(cls, schema: Schema, rows: Iterable[Mapping[str, Any]]) -> "RecordBatch":
        """Build a batch from dictionaries, filling absent keys with null."""
        names = schema.names
        materialized = list(rows)
        columns = []
        for field in schema:
            values = [_lookup(row, field.name) for row in materialized]
            columns.append(Column(field.name, field.dtype, values))
        del names
        return cls(schema, columns)

    @classmethod
    def from_columns(cls, columns: Sequence[Column]) -> "RecordBatch":
        """Build a batch and derive its schema from the columns themselves."""
        schema = Schema(Field(column.name, column.dtype) for column in columns)
        return cls(schema, columns)

    # ------------------------------------------------------------------
    # Basic access
    # ------------------------------------------------------------------
    @property
    def schema(self) -> Schema:
        """The batch schema."""
        return self._schema

    @property
    def columns(self) -> List[Column]:
        """The batch columns in schema order."""
        return self._columns

    @property
    def num_rows(self) -> int:
        """How many rows the batch holds."""
        return self._num_rows

    @property
    def num_columns(self) -> int:
        """How many columns the batch holds."""
        return len(self._columns)

    def __len__(self) -> int:
        return self._num_rows

    def __bool__(self) -> bool:
        return self._num_rows > 0

    def __repr__(self) -> str:
        return f"RecordBatch({self._num_rows} rows, {self.num_columns} columns)"

    def column(self, key: int | str) -> Column:
        """Return a column by position or (case-insensitive) name."""
        if isinstance(key, int):
            return self._columns[key]
        return self._columns[self._schema.index_of(key)]

    def has_column(self, name: str) -> bool:
        """True when the batch carries a column with this name."""
        return self._schema.has(name)

    def value(self, row: int, key: int | str) -> Any:
        """Return a single cell."""
        return self.column(key)[row]

    def row(self, index: int) -> Dict[str, Any]:
        """Return one row as a name to value dictionary."""
        return {column.name: column[index] for column in self._columns}

    def row_tuple(self, index: int) -> tuple:
        """Return one row as a tuple in schema order."""
        return tuple(column[index] for column in self._columns)

    def rows(self) -> Iterator[Dict[str, Any]]:
        """Iterate over rows as dictionaries."""
        for index in range(self._num_rows):
            yield self.row(index)

    def tuples(self) -> Iterator[tuple]:
        """Iterate over rows as tuples in schema order."""
        for index in range(self._num_rows):
            yield self.row_tuple(index)

    def to_rows(self) -> List[tuple]:
        """Materialise every row as a tuple."""
        return list(self.tuples())

    def to_dicts(self) -> List[Dict[str, Any]]:
        """Materialise every row as a dictionary."""
        return list(self.rows())

    # ------------------------------------------------------------------
    # Derivation
    # ------------------------------------------------------------------
    def select(self, names: Sequence[str]) -> "RecordBatch":
        """Return a batch with only the named columns, in the order given."""
        columns = [self.column(name) for name in names]
        return RecordBatch(self._schema.select(names), columns)

    def project(self, indices: Sequence[int]) -> "RecordBatch":
        """Return a batch with columns selected positionally."""
        return RecordBatch(
            self._schema.project(indices), [self._columns[index] for index in indices]
        )

    def take(self, indices: Sequence[int]) -> "RecordBatch":
        """Gather rows at the given positions, in the order given."""
        return RecordBatch(self._schema, [column.take(indices) for column in self._columns])

    def filter(self, mask: Sequence[Optional[bool]]) -> "RecordBatch":
        """Keep rows whose mask entry is exactly ``True``."""
        if len(mask) != self._num_rows:
            raise SchemaError(
                f"filter mask has {len(mask)} entries for {self._num_rows} rows"
            )
        return RecordBatch(self._schema, [column.filter(mask) for column in self._columns])

    def slice(self, offset: int, length: Optional[int] = None) -> "RecordBatch":
        """Return a contiguous window of rows."""
        return RecordBatch(
            self._schema, [column.slice(offset, length) for column in self._columns]
        )

    def with_column(self, column: Column, replace: bool = True) -> "RecordBatch":
        """Return a batch with ``column`` added or replacing an existing one."""
        if column.name and self._schema.has(column.name) and replace:
            position = self._schema.index_of(column.name)
            columns = list(self._columns)
            columns[position] = column
            fields = list(self._schema)
            fields[position] = Field(column.name, column.dtype, fields[position].nullable)
            return RecordBatch(Schema(fields), columns)
        return RecordBatch(
            self._schema.add(Field(column.name, column.dtype)), self._columns + [column]
        )

    def rename(self, mapping: Mapping[str, str]) -> "RecordBatch":
        """Return a batch with columns renamed."""
        schema = self._schema.rename(mapping)
        columns = [
            column.rename(field.name) for column, field in zip(self._columns, schema)
        ]
        return RecordBatch(schema, columns)

    def cast(self, schema: Schema) -> "RecordBatch":
        """Return a batch whose columns are cast to ``schema``'s types."""
        if len(schema) != self.num_columns:
            raise SchemaError("cast target schema has a different column count")
        columns = [
            column.cast(field.dtype).rename(field.name)
            for column, field in zip(self._columns, schema)
        ]
        return RecordBatch(schema, columns)

    @staticmethod
    def concat(batches: Sequence["RecordBatch"], schema: Optional[Schema] = None) -> "RecordBatch":
        """Vertically concatenate batches that share a schema.

        Raises:
            SchemaError: If no schema can be determined for an empty input.
        """
        materialized = list(batches)
        if not materialized:
            if schema is None:
                raise SchemaError("cannot concatenate zero batches without a schema")
            return RecordBatch.empty(schema)
        target = schema or materialized[0].schema
        buffers: List[List[Any]] = [[] for _ in target]
        for batch in materialized:
            for index, field in enumerate(target):
                buffers[index].extend(batch.column(field.name).values)
        columns = [
            Column(field.name, field.dtype, buffer)
            for field, buffer in zip(target, buffers)
        ]
        return RecordBatch(target, columns)


def _lookup(row: Mapping[str, Any], name: str) -> Any:
    """Fetch ``name`` from a row dictionary, ignoring key case."""
    if name in row:
        return row[name]
    lowered = name.lower()
    for key, value in row.items():
        if key.lower() == lowered:
            return value
    return None
