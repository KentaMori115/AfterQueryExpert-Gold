"""Table scan operators."""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence

from ...plan.expressions import Expr
from ...storage.table import Table
from ...types.schema import Schema
from ..batch import RecordBatch
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import LeafOperator

__all__ = ["TableScan", "SingleRowScan", "EmptyScan"]


class TableScan(LeafOperator):
    """Reads a table, optionally projecting and filtering as it goes.

    Filters pushed into the scan are applied before batching, so a selective
    predicate keeps memory flat regardless of the table size.
    """

    def __init__(
        self,
        table: Table,
        output_schema: Schema,
        *,
        projection: Optional[Sequence[int]] = None,
        filters: Sequence[Expr] = (),
    ) -> None:
        self._table = table
        self._schema = output_schema
        self._projection = list(projection) if projection is not None else None
        self._filters = tuple(filters)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def table(self) -> Table:
        return self._table

    def describe(self) -> str:
        text = f"TableScan {self._table.name}"
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
        buffer: list[list[Any]] = []
        size = context.batch_size
        for row in self._table.scan(self._projection):
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


class SingleRowScan(LeafOperator):
    """Emits exactly one row with no columns.

    This backs ``SELECT <expr>`` without a FROM clause, which projects over a
    single anonymous row.
    """

    def __init__(self, schema: Optional[Schema] = None) -> None:
        self._schema = schema if schema is not None else Schema.empty()

    @property
    def schema(self) -> Schema:
        return self._schema

    def describe(self) -> str:
        return "SingleRow"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        context.metrics.record_batch(1)
        yield RecordBatch(schema=self._schema, rows=[[]])


class EmptyScan(LeafOperator):
    """Emits nothing at all, preserving a schema."""

    def __init__(self, schema: Schema) -> None:
        self._schema = schema

    @property
    def schema(self) -> Schema:
        return self._schema

    def describe(self) -> str:
        return f"Empty [{', '.join(self._schema.names)}]"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        return iter(())
