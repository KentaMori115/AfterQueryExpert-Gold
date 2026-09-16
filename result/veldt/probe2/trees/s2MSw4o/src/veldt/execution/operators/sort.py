"""The sort operator.

Sorting is blocking: every input batch is buffered before the first output row
can be produced. Multiple keys are handled by sorting once per key from the
least significant to the most significant, which works because Python's sort
is stable.
"""

from __future__ import annotations

from typing import Any, Iterator, List, Sequence, Tuple

from ...core.batch import RecordBatch
from ...core.column import Column
from ...plan.logical import SortKey
from ...types.value import sort_key as value_sort_key
from ...utils.iterables import chunked
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["SortOperator"]


class SortOperator(UnaryOperator):
    """Orders every input row by one or more keys."""

    def __init__(self, child: Operator, keys: Sequence[SortKey]) -> None:
        super().__init__(child)
        if not keys:
            raise ValueError("sort requires at least one key")
        self.keys = tuple(keys)

    @property
    def is_blocking(self) -> bool:
        return True

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        batches = list(self.child.execute(context))
        if not batches:
            return
        combined = RecordBatch.concat(batches, self.schema)
        order = self._compute_order(combined, context)
        context.metrics.increment("sort.rows_buffered", combined.num_rows)
        sorted_batch = combined.take(order)
        for start in range(0, sorted_batch.num_rows, context.batch_size):
            yield sorted_batch.slice(start, context.batch_size)

    def _compute_order(self, batch: RecordBatch, context: ExecutionContext) -> List[int]:
        """Return the row indices in sorted order."""
        evaluator = context.evaluator
        order = list(range(batch.num_rows))
        for key in reversed(self.keys):
            column = evaluator.evaluate(key.expression, batch)
            values = column.values
            descending = not key.ascending
            # Under a reversed sort the null bucket moves to the other end, so
            # the requested placement has to be inverted to compensate.
            nulls_first = key.nulls_first_effective
            effective = nulls_first if key.ascending else not nulls_first
            order.sort(
                key=lambda index: value_sort_key(values[index], effective),
                reverse=descending,
            )
        return order

    def describe(self) -> str:
        return "Sort(" + ", ".join(key.describe() for key in self.keys) + ")"
