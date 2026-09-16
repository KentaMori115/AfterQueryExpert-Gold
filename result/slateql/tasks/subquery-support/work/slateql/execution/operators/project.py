"""Projection: computing the output tuple shape."""

from __future__ import annotations

from typing import Iterator, Sequence

from ...plan.logical import NamedExpr
from ...types.schema import Field, Schema
from ..batch import RecordBatch
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import Operator, UnaryOperator

__all__ = ["ProjectOperator"]


class ProjectOperator(UnaryOperator):
    """Evaluates one expression per output column."""

    def __init__(self, child: Operator, projections: Sequence[NamedExpr]) -> None:
        super().__init__(child)
        self._projections = tuple(projections)
        self._schema = Schema(
            Field(name=item.name, dtype=item.expression.dtype)
            for item in self._projections
        )

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def projections(self) -> tuple[NamedExpr, ...]:
        return self._projections

    def describe(self) -> str:
        inner = ", ".join(item.describe() for item in self._projections)
        return f"Project [{inner}]"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = ExpressionEvaluator(
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )
        functions = evaluator.compile_all(
            [item.expression for item in self._projections], self.child.schema
        )
        schema = self._schema
        for batch in self.child.execute(context):
            rows = [[function(row) for function in functions] for row in batch.rows]
            if not rows:
                continue
            context.metrics.record_batch(len(rows))
            yield RecordBatch(schema=schema, rows=rows)
