"""A literal, fully materialised relation.

Used by the metadata statements (``SHOW TABLES``, ``SHOW COLUMNS``) which
produce rows the engine computed rather than read from a table.
"""

from __future__ import annotations

from typing import Any, Iterator, Sequence

from ...errors import ExecutionError
from ...types.schema import Schema
from ..batch import RecordBatch, batches_from_rows
from ..context import ExecutionContext
from .base import LeafOperator

__all__ = ["ValuesOperator"]


class ValuesOperator(LeafOperator):
    """Emits a fixed set of rows."""

    def __init__(self, schema: Schema, rows: Sequence[Sequence[Any]]) -> None:
        width = len(schema)
        for index, row in enumerate(rows):
            if len(row) != width:
                raise ExecutionError(
                    f"values row {index} has {len(row)} columns, expected {width}"
                )
        self._schema = schema
        self._rows = [list(row) for row in rows]

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def row_count(self) -> int:
        return len(self._rows)

    def describe(self) -> str:
        return f"Values ({len(self._rows)} rows)"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        if not self._rows:
            return
        for batch in batches_from_rows(self._schema, self._rows, context.batch_size):
            context.metrics.record_batch(len(batch))
            yield batch
