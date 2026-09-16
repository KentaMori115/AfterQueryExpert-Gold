"""Duplicate elimination."""

from __future__ import annotations

from typing import Any, Iterator

from ..batch import RecordBatch
from ..context import ExecutionContext
from ..keys import row_key
from .base import Operator, UnaryOperator

__all__ = ["DistinctOperator"]


class DistinctOperator(UnaryOperator):
    """Emits the first occurrence of each distinct row.

    Two rows are duplicates when every column compares equal, with NULL
    treated as equal to NULL -- the grouping rule, not the comparison rule.
    Output preserves input order, which keeps results reproducible.
    """

    def __init__(self, child: Operator) -> None:
        super().__init__(child)

    def describe(self) -> str:
        return "Distinct"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        seen: set[tuple] = set()
        schema = self.schema
        for batch in self.child.execute(context):
            kept: list[list[Any]] = []
            for row in batch.rows:
                key = row_key(row)
                if key in seen:
                    continue
                seen.add(key)
                kept.append(row)
            if not kept:
                continue
            context.metrics.record_batch(len(kept))
            yield RecordBatch(schema=schema, rows=kept)
