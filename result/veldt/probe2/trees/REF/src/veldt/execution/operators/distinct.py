"""The distinct operator."""

from __future__ import annotations

from typing import Iterator, List, Optional, Sequence

from ...core.batch import RecordBatch
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["DistinctOperator"]


class DistinctOperator(UnaryOperator):
    """Emits the first occurrence of each distinct row.

    The operator streams: it emits a filtered batch as soon as it has seen one,
    rather than buffering the whole input. The set of keys seen so far still
    grows with the number of distinct rows, which is unavoidable.

    Two rows are the same when every column matches by value and by type, so
    ``1`` and ``1.0`` are distinct, and two nulls are the same.
    """

    def __init__(self, child: Operator, subset: Optional[Sequence[str]] = None) -> None:
        super().__init__(child)
        self.subset = list(subset) if subset is not None else None

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        seen: set = set()
        names = self.subset if self.subset is not None else self.schema.names
        for batch in self.child.execute(context):
            columns = [batch.column(name) for name in names]
            mask: List[bool] = []
            for row in range(batch.num_rows):
                key = row_key(column[row] for column in columns)
                if key in seen:
                    mask.append(False)
                    continue
                seen.add(key)
                mask.append(True)
            kept = sum(1 for value in mask if value)
            if kept == batch.num_rows:
                yield batch
            elif kept:
                yield batch.filter(mask)
            context.metrics.increment("distinct.rows_dropped", batch.num_rows - kept)

    def describe(self) -> str:
        if self.subset is None:
            return "Distinct"
        return f"Distinct(on=[{', '.join(self.subset)}])"
