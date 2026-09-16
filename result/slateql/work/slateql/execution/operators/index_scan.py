"""Reading a table through one of its indexes.

The operator is the scan's other shape: instead of pulling every row from the
source and throwing most away, it asks an index which rows can match, then
fetches those and nothing else.  Everything downstream is unchanged, so the
rows arrive in the same positions a full scan would have produced them in,
and predicates the index could not answer are still applied here.

Rows are fetched one at a time inside the generator, which is what lets a
LIMIT above an ordered read stop the scan early instead of paying for rows
nobody asked for.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence

from ...plan.expressions import Expr
from ...storage.table import Table
from ...types.schema import Schema
from ..access_path import AccessPath
from ..batch import RecordBatch
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import LeafOperator

__all__ = ["IndexScan"]


class IndexScan(LeafOperator):
    """Fetches the rows an index selects, in the order the path reports them."""

    def __init__(
        self,
        table: Table,
        path: AccessPath,
        output_schema: Schema,
        *,
        projection: Optional[Sequence[int]] = None,
        filters: Sequence[Expr] = (),
    ) -> None:
        self._table = table
        self._path = path
        self._schema = output_schema
        self._projection = list(projection) if projection is not None else None
        self._filters = tuple(filters)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def table(self) -> Table:
        return self._table

    @property
    def path(self) -> AccessPath:
        return self._path

    def describe(self) -> str:
        text = f"IndexScan {self._table.name} {self._path.describe()}"
        if self._projection is not None:
            text += f" [{', '.join(self._schema.names)}]"
        if self._filters:
            text += " filter=" + " AND ".join(f.to_sql() for f in self._filters)
        return text

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = ExpressionEvaluator(
            context.registry, strict_casts=context.strict_casts
        )
        predicates = [
            evaluator.compile_predicate(expression, self._schema)
            for expression in self._filters
        ]
        index = self._path.index
        projection = self._projection
        buffer: list[list[Any]] = []
        size = context.batch_size
        for offset in self._path.offsets():
            (row,) = index.rows_at((offset,))
            if projection is not None:
                row = [row[position] for position in projection]
            context.metrics.rows_scanned += 1
            if predicates and not all(predicate(row) for predicate in predicates):
                continue
            buffer.append(row)
            if len(buffer) >= size:
                context.metrics.record_batch(len(buffer))
                yield RecordBatch(schema=self._schema, rows=buffer)
                buffer = []
        if buffer:
            context.metrics.record_batch(len(buffer))
            yield RecordBatch(schema=self._schema, rows=buffer)
