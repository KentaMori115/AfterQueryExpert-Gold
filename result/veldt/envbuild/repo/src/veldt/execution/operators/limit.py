"""The limit operator."""

from __future__ import annotations

from typing import Iterator, Optional

from ...core.batch import RecordBatch
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["LimitOperator"]


class LimitOperator(UnaryOperator):
    """Skips ``offset`` rows then emits at most ``count`` of them.

    The operator stops pulling from its child as soon as it has enough rows,
    which is what makes ``LIMIT`` cheap over a large scan.
    """

    def __init__(self, child: Operator, count: Optional[int] = None, offset: int = 0) -> None:
        super().__init__(child)
        if count is not None and count < 0:
            raise ValueError("limit count must not be negative")
        if offset < 0:
            raise ValueError("limit offset must not be negative")
        self.count = count
        self.offset = offset

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        if self.count == 0:
            return
        skipped = 0
        emitted = 0
        for batch in self.child.execute(context):
            if skipped < self.offset:
                skip_here = min(self.offset - skipped, batch.num_rows)
                skipped += skip_here
                if skip_here == batch.num_rows:
                    continue
                batch = batch.slice(skip_here)
            if self.count is None:
                emitted += batch.num_rows
                yield batch
                continue
            remaining = self.count - emitted
            if remaining <= 0:
                return
            if batch.num_rows > remaining:
                emitted += remaining
                yield batch.slice(0, remaining)
                return
            emitted += batch.num_rows
            yield batch
            if emitted >= self.count:
                return

    def describe(self) -> str:
        count = "all" if self.count is None else str(self.count)
        return f"Limit(count={count}, offset={self.offset})"
