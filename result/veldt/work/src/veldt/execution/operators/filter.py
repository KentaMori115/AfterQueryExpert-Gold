"""The filter operator."""

from __future__ import annotations

from typing import Iterator

from ...core.batch import RecordBatch
from ...expr.ast import Expression
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["FilterOperator"]


class FilterOperator(UnaryOperator):
    """Keeps rows whose predicate evaluates to exactly true.

    A predicate that evaluates to ``NULL`` drops the row, which is what SQL
    requires: only a definite true selects.
    """

    def __init__(self, child: Operator, predicate: Expression) -> None:
        super().__init__(child)
        self.predicate = predicate

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = context.evaluator
        for batch in self.child.execute(context):
            mask = evaluator.evaluate_predicate(self.predicate, batch)
            kept = sum(1 for value in mask if value is True)
            if kept == batch.num_rows:
                yield batch
                continue
            context.metrics.increment("filter.rows_dropped", batch.num_rows - kept)
            if kept:
                yield batch.filter(mask)

    def describe(self) -> str:
        return f"Filter({self.predicate.to_sql()})"
