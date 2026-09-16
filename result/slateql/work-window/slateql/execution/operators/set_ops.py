"""Set operations."""

from __future__ import annotations

from typing import Any, Iterator

from ...errors import ExecutionError
from ...types.schema import Schema
from ...types.values import cast_value
from ..batch import RecordBatch
from ..context import ExecutionContext
from ..keys import row_key
from .base import BinaryOperator, Operator

__all__ = ["UnionOperator"]


class UnionOperator(BinaryOperator):
    """Concatenates two inputs, optionally removing duplicates.

    Both arms are coerced to the union's output types on the way through, so
    an INTEGER arm and a DOUBLE arm produce one consistently typed result.
    """

    def __init__(
        self,
        left: Operator,
        right: Operator,
        output_schema: Schema,
        *,
        all_rows: bool = False,
    ) -> None:
        super().__init__(left, right)
        if len(left.schema) != len(output_schema) or len(right.schema) != len(
            output_schema
        ):
            raise ExecutionError("UNION arms must have the same number of columns")
        self._schema = output_schema
        self._all_rows = all_rows

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def all_rows(self) -> bool:
        return self._all_rows

    def describe(self) -> str:
        return "Union All" if self._all_rows else "Union"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        seen: set[tuple] = set()
        targets = [field.dtype for field in self._schema]
        for side in (self.left, self.right):
            needs_cast = [
                field.dtype.kind is not target.kind
                for field, target in zip(side.schema, targets)
            ]
            for batch in side.execute(context):
                kept: list[list[Any]] = []
                for row in batch.rows:
                    converted = [
                        cast_value(value, targets[index])
                        if needs_cast[index]
                        else value
                        for index, value in enumerate(row)
                    ]
                    if not self._all_rows:
                        key = row_key(converted)
                        if key in seen:
                            continue
                        seen.add(key)
                    kept.append(converted)
                if not kept:
                    continue
                context.metrics.record_batch(len(kept))
                yield RecordBatch(schema=self._schema, rows=kept)
