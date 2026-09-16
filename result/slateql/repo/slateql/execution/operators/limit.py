"""OFFSET/LIMIT."""

from __future__ import annotations

from typing import Iterator, Optional

from ..batch import RecordBatch
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["LimitOperator"]


class LimitOperator(UnaryOperator):
    """Skips ``offset`` rows then emits at most ``count`` rows.

    The operator stops pulling from its child as soon as the limit is met, so
    a ``LIMIT 5`` over a million-row scan reads only what it needs.
    """

    def __init__(
        self, child: Operator, count: Optional[int] = None, offset: int = 0
    ) -> None:
        super().__init__(child)
        self._count = count
        self._offset = max(offset, 0)

    @property
    def count(self) -> Optional[int]:
        return self._count

    @property
    def offset(self) -> int:
        return self._offset

    def describe(self) -> str:
        parts = []
        if self._count is not None:
            parts.append(f"count={self._count}")
        if self._offset:
            parts.append(f"offset={self._offset}")
        return "Limit " + " ".join(parts) if parts else "Limit"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        if self._count == 0:
            return
        remaining = self._count
        to_skip = self._offset
        schema = self.schema
        for batch in self.child.execute(context):
            rows = batch.rows
            if to_skip:
                if len(rows) <= to_skip:
                    to_skip -= len(rows)
                    continue
                rows = rows[to_skip:]
                to_skip = 0
            if remaining is not None:
                if len(rows) > remaining:
                    rows = rows[:remaining]
                remaining -= len(rows)
            if rows:
                context.metrics.record_batch(len(rows))
                yield RecordBatch(schema=schema, rows=rows)
            if remaining is not None and remaining <= 0:
                return
