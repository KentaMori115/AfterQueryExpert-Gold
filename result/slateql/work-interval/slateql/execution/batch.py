"""Record batches: the unit of data operators exchange.

Operators pass lists of rows rather than single rows so that the per-row
Python overhead is amortised over a whole block.  An operator must never emit
an empty batch: consumers are allowed to treat "a batch arrived" as "there is
work to do".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Optional, Sequence

from ..errors import ExecutionError
from ..types.schema import Schema

__all__ = ["RecordBatch", "batches_from_rows", "concat_batches"]


@dataclass(frozen=True)
class RecordBatch:
    """A block of rows sharing one schema."""

    schema: Schema
    rows: list[list[Any]]

    def __post_init__(self) -> None:
        width = len(self.schema)
        for index, row in enumerate(self.rows):
            if len(row) != width:
                raise ExecutionError(
                    f"batch row {index} has {len(row)} values but the schema "
                    f"declares {width} columns"
                )

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[list[Any]]:
        return iter(self.rows)

    @property
    def is_empty(self) -> bool:
        return not self.rows

    @property
    def width(self) -> int:
        return len(self.schema)

    def slice(self, start: int, stop: Optional[int] = None) -> "RecordBatch":
        """Return a batch holding ``rows[start:stop]``."""

        return RecordBatch(schema=self.schema, rows=self.rows[start:stop])

    def project(self, indices: Sequence[int], schema: Schema) -> "RecordBatch":
        """Select and reorder columns, adopting ``schema`` as the new schema."""

        return RecordBatch(
            schema=schema,
            rows=[[row[index] for index in indices] for row in self.rows],
        )

    def with_schema(self, schema: Schema) -> "RecordBatch":
        """Reinterpret the batch under a different but same-width schema."""

        if len(schema) != len(self.schema):
            raise ExecutionError(
                "cannot relabel a batch with a schema of a different width"
            )
        return RecordBatch(schema=schema, rows=self.rows)

    def column(self, index: int) -> list[Any]:
        return [row[index] for row in self.rows]

    @classmethod
    def empty(cls, schema: Schema) -> "RecordBatch":
        return cls(schema=schema, rows=[])

    def to_dicts(self) -> list[dict[str, Any]]:
        names = self.schema.names
        return [dict(zip(names, row)) for row in self.rows]


def batches_from_rows(
    schema: Schema, rows: Iterable[Sequence[Any]], batch_size: int
) -> Iterator[RecordBatch]:
    """Group ``rows`` into batches of at most ``batch_size`` rows."""

    if batch_size <= 0:
        raise ExecutionError("batch size must be positive")
    buffer: list[list[Any]] = []
    for row in rows:
        buffer.append(list(row))
        if len(buffer) >= batch_size:
            yield RecordBatch(schema=schema, rows=buffer)
            buffer = []
    if buffer:
        yield RecordBatch(schema=schema, rows=buffer)


def concat_batches(schema: Schema, batches: Iterable[RecordBatch]) -> RecordBatch:
    """Merge several batches into one."""

    rows: list[list[Any]] = []
    for batch in batches:
        rows.extend(batch.rows)
    return RecordBatch(schema=schema, rows=rows)
