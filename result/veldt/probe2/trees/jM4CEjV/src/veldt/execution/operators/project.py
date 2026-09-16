"""The projection operator."""

from __future__ import annotations

from typing import Iterator, List, Sequence

from ...core.batch import RecordBatch
from ...expr.ast import Expression
from ...types.schema import Schema
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["ProjectOperator"]


class ProjectOperator(UnaryOperator):
    """Evaluates a list of expressions to build each output batch."""

    def __init__(
        self, child: Operator, projections: Sequence[Expression], schema: Schema
    ) -> None:
        super().__init__(child)
        self.projections = tuple(projections)
        self._schema = schema

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = context.evaluator
        for batch in self.child.execute(context):
            columns = []
            for expression, field in zip(self.projections, self._schema):
                column = evaluator.evaluate(expression, batch)
                columns.append(
                    column if column.name == field.name else column.rename(field.name)
                )
            yield RecordBatch(self._schema, columns)

    def describe(self) -> str:
        rendered = ", ".join(item.to_sql() for item in self.projections)
        return f"Project({rendered})"
