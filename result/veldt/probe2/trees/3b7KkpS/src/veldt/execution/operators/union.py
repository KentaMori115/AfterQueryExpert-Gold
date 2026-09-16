"""The union operator."""

from __future__ import annotations

from typing import Iterator

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["UnionOperator"]


class UnionOperator(BinaryOperator):
    """Concatenates two inputs, casting both to a common schema.

    Duplicate removal is not this operator's job: a plain ``UNION`` is compiled
    as a union followed by a distinct, which keeps each operator to one
    responsibility. The other two set operators cannot delegate that way, since
    they have to count copies; they live in :mod:`veldt.execution.operators.setop`
    and are blocking, while concatenation streams.
    """

    def __init__(self, left: Operator, right: Operator, schema: Schema) -> None:
        super().__init__(left, right)
        self._schema = schema

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        for side in (self.left, self.right):
            for batch in side.execute(context):
                yield batch if batch.schema == self._schema else batch.cast(self._schema)

    def describe(self) -> str:
        return "Union"
