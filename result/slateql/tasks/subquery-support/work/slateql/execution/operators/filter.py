"""Row filtering."""

from __future__ import annotations

from typing import Iterator

from ...plan.expressions import Expr
from ..batch import RecordBatch
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import Operator, UnaryOperator

__all__ = ["FilterOperator"]


class FilterOperator(UnaryOperator):
    """Keeps rows whose predicate evaluates to TRUE.

    NULL is not TRUE, so rows where the predicate is unknown are dropped --
    the same rule WHERE and HAVING use.
    """

    def __init__(self, child: Operator, predicate: Expr) -> None:
        super().__init__(child)
        self._predicate = predicate

    @property
    def predicate(self) -> Expr:
        return self._predicate

    def describe(self) -> str:
        return f"Filter {self._predicate.to_sql()}"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = ExpressionEvaluator(
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )
        predicate = evaluator.compile_predicate(self._predicate, self.child.schema)
        schema = self.schema
        for batch in self.child.execute(context):
            kept = [row for row in batch.rows if predicate(row)]
            if not kept:
                continue
            context.metrics.record_batch(len(kept))
            yield RecordBatch(schema=schema, rows=kept)
