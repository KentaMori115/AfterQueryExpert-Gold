"""Sorting."""

from __future__ import annotations

from typing import Any, Iterator, Sequence

from ...plan.logical import SortItem
from ...util.ordering import SortKey, make_row_key
from ..batch import RecordBatch, batches_from_rows
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import Operator, UnaryOperator

__all__ = ["SortOperator"]


class SortOperator(UnaryOperator):
    """Materialises the input and sorts it.

    Python's sort is stable, so equal keys preserve input order.  That is what
    makes ``ORDER BY`` on a non-unique key reproducible run after run.
    """

    def __init__(self, child: Operator, keys: Sequence[SortItem]) -> None:
        super().__init__(child)
        self._keys = tuple(keys)

    @property
    def keys(self) -> tuple[SortItem, ...]:
        return self._keys

    def describe(self) -> str:
        inner = ", ".join(key.describe() for key in self._keys)
        return f"Sort [{inner}]"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = ExpressionEvaluator(
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )
        schema = self.child.schema
        sort_keys = [
            SortKey(
                getter=evaluator.compile(key.expression, schema),
                descending=key.descending,
                nulls_first=key.nulls_first,
            )
            for key in self._keys
        ]
        rows: list[list[Any]] = []
        for batch in self.child.execute(context):
            rows.extend(batch.rows)
        if not rows:
            return
        rows.sort(key=make_row_key(sort_keys))
        for batch in batches_from_rows(self.schema, rows, context.batch_size):
            context.metrics.record_batch(len(batch))
            yield batch
