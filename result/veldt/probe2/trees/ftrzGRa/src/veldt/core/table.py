"""Tables: a schema plus a sequence of record batches.

A table is what the engine hands back to a caller and what an in-memory data
source hands to the scan operator. It keeps its batches separate rather than
concatenating them, so a large result can be streamed out again without a
second full copy.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence

from ..errors import SchemaError
from ..types.dtypes import DataType
from ..types.schema import Field, Schema
from ..utils.iterables import chunked
from .batch import RecordBatch
from .column import Column

__all__ = ["Table"]

DEFAULT_BATCH_SIZE = 1024


class Table:
    """An immutable collection of batches sharing one schema."""

    __slots__ = ("_schema", "_batches", "_num_rows")

    def __init__(self, schema: Schema, batches: Sequence[RecordBatch] = ()) -> None:
        self._schema = schema
        kept: List[RecordBatch] = []
        for batch in batches:
            if batch.schema != schema:
                raise SchemaError("batch schema does not match table schema")
            if batch.num_rows:
                kept.append(batch)
        self._batches: List[RecordBatch] = kept
        self._num_rows = sum(batch.num_rows for batch in kept)

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def empty(cls, schema: Schema) -> "Table":
        """Return a table with no rows."""
        return cls(schema, ())

    @classmethod
    def from_batches(
        cls, batches: Sequence[RecordBatch], schema: Optional[Schema] = None
    ) -> "Table":
        """Build a table from batches, inferring the schema when possible.

        Raises:
            SchemaError: If no batches are given and no schema is supplied.
        """
        materialized = list(batches)
        if schema is None:
            if not materialized:
                raise SchemaError("cannot build a table from zero batches without a schema")
            schema = materialized[0].schema
        return cls(schema, materialized)

    @classmethod
    def from_rows(
        cls,
        schema: Schema,
        rows: Iterable[Sequence[Any]],
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> "Table":
        """Build a table from row tuples, chunked into batches."""
        batches = [
            RecordBatch.from_rows(schema, chunk) for chunk in chunked(rows, batch_size)
        ]
        return cls(schema, batches)

    @classmethod
    def from_dicts(
        cls,
        rows: Iterable[Mapping[str, Any]],
        schema: Optional[Schema] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> "Table":
        """Build a table from dictionaries, inferring a schema when absent."""
        materialized = [dict(row) for row in rows]
        if schema is None:
            schema = _infer_schema(materialized)
        batches = [
            RecordBatch.from_dicts(schema, chunk)
            for chunk in chunked(materialized, batch_size)
        ]
        return cls(schema, batches)

    @classmethod
    def from_columns(cls, columns: Sequence[Column]) -> "Table":
        """Build a single-batch table from whole columns."""
        batch = RecordBatch.from_columns(columns)
        return cls(batch.schema, [batch])

    # ------------------------------------------------------------------
    # Basic access
    # ------------------------------------------------------------------
    @property
    def schema(self) -> Schema:
        """The table schema."""
        return self._schema

    @property
    def batches(self) -> List[RecordBatch]:
        """The non-empty batches making up the table."""
        return self._batches

    @property
    def num_rows(self) -> int:
        """Total row count across all batches."""
        return self._num_rows

    @property
    def num_columns(self) -> int:
        """Column count."""
        return len(self._schema)

    @property
    def column_names(self) -> List[str]:
        """Column names in schema order."""
        return self._schema.names

    def __len__(self) -> int:
        return self._num_rows

    def __bool__(self) -> bool:
        return self._num_rows > 0

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        return self.rows()

    def __repr__(self) -> str:
        return f"Table({self._num_rows} rows, {self.num_columns} columns)"

    def is_empty(self) -> bool:
        """True when the table has no rows."""
        return self._num_rows == 0

    def iter_batches(self) -> Iterator[RecordBatch]:
        """Iterate over the underlying batches."""
        return iter(self._batches)

    def rows(self) -> Iterator[Dict[str, Any]]:
        """Iterate over every row as a dictionary."""
        for batch in self._batches:
            yield from batch.rows()

    def tuples(self) -> Iterator[tuple]:
        """Iterate over every row as a tuple in schema order."""
        for batch in self._batches:
            yield from batch.tuples()

    def to_rows(self) -> List[tuple]:
        """Materialise every row as a tuple."""
        return list(self.tuples())

    def to_dicts(self) -> List[Dict[str, Any]]:
        """Materialise every row as a dictionary."""
        return list(self.rows())

    def row(self, index: int) -> Dict[str, Any]:
        """Return a single row by absolute position.

        Raises:
            IndexError: If the index is out of range.
        """
        if index < 0:
            index += self._num_rows
        if index < 0 or index >= self._num_rows:
            raise IndexError(f"row index {index} out of range for {self._num_rows} rows")
        offset = index
        for batch in self._batches:
            if offset < batch.num_rows:
                return batch.row(offset)
            offset -= batch.num_rows
        raise IndexError(index)  # pragma: no cover - guarded above

    def column(self, name: str) -> Column:
        """Return one whole column, concatenated across batches."""
        field = self._schema.field(name)
        values: List[Any] = []
        for batch in self._batches:
            values.extend(batch.column(field.name).values)
        return Column(field.name, field.dtype, values)

    # ------------------------------------------------------------------
    # Derivation
    # ------------------------------------------------------------------
    def select(self, names: Sequence[str]) -> "Table":
        """Return a table with only the named columns."""
        return Table(
            self._schema.select(names), [batch.select(names) for batch in self._batches]
        )

    def head(self, count: int = 10) -> "Table":
        """Return the first ``count`` rows."""
        if count <= 0:
            return Table.empty(self._schema)
        kept: List[RecordBatch] = []
        remaining = count
        for batch in self._batches:
            if remaining <= 0:
                break
            if batch.num_rows <= remaining:
                kept.append(batch)
                remaining -= batch.num_rows
            else:
                kept.append(batch.slice(0, remaining))
                remaining = 0
        return Table(self._schema, kept)

    def rename(self, mapping: Mapping[str, str]) -> "Table":
        """Return a table with columns renamed."""
        schema = self._schema.rename(mapping)
        return Table(schema, [batch.rename(mapping) for batch in self._batches])

    def rechunk(self, batch_size: int = DEFAULT_BATCH_SIZE) -> "Table":
        """Return an equivalent table with uniformly sized batches."""
        return Table.from_rows(self._schema, self.tuples(), batch_size)

    def concat(self, other: "Table") -> "Table":
        """Append another table with an identical schema.

        Raises:
            SchemaError: If the schemas differ.
        """
        if self._schema != other.schema:
            raise SchemaError("cannot concatenate tables with different schemas")
        return Table(self._schema, self._batches + other.batches)

    def equals(self, other: "Table") -> bool:
        """Structural equality: same schema and same rows in the same order."""
        if not isinstance(other, Table):
            return False
        if self._schema != other.schema or self._num_rows != other.num_rows:
            return False
        return self.to_rows() == other.to_rows()


def _infer_schema(rows: Sequence[Mapping[str, Any]]) -> Schema:
    """Derive a schema from dictionary rows, preserving key order."""
    from ..types.dtypes import infer_dtype, promote
    from ..types.value import is_null

    order: List[str] = []
    types: Dict[str, DataType] = {}
    for row in rows:
        for key, value in row.items():
            if key not in types:
                order.append(key)
                types[key] = DataType.NULL
            if is_null(value):
                continue
            observed = infer_dtype(value)
            merged = promote(types[key], observed)
            types[key] = merged if merged is not None else DataType.STRING
    return Schema(Field(name, types[name]) for name in order)
