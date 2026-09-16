"""Runs an operator tree and collects its output."""

from __future__ import annotations

from typing import Any, Iterator, Optional

from ..result import QueryResult
from ..types.schema import Schema
from .batch import RecordBatch
from .context import ExecutionContext
from .operators.base import Operator

__all__ = ["execute_operator", "collect", "stream_rows"]


def execute_operator(
    operator: Operator, context: ExecutionContext
) -> Iterator[RecordBatch]:
    """Iterate the batches an operator produces, enforcing the row budget."""

    produced = 0
    for batch in operator.execute(context):
        produced += len(batch)
        context.check_row_budget(produced)
        yield batch


def stream_rows(operator: Operator, context: ExecutionContext) -> Iterator[list[Any]]:
    """Flatten an operator's batches into a stream of rows."""

    for batch in execute_operator(operator, context):
        yield from batch.rows


def collect(
    operator: Operator,
    context: ExecutionContext,
    *,
    statement: str = "",
    schema: Optional[Schema] = None,
) -> QueryResult:
    """Run ``operator`` to completion and wrap the rows in a result."""

    rows: list[list[Any]] = []
    for batch in execute_operator(operator, context):
        rows.extend(batch.rows)
    metrics = {
        "rows_scanned": context.metrics.rows_scanned,
        "rows_emitted": context.metrics.rows_emitted,
        "batches_emitted": context.metrics.batches_emitted,
        "groups_created": context.metrics.groups_created,
    }
    return QueryResult(
        schema=schema if schema is not None else operator.schema,
        rows=rows,
        statement=statement,
        metrics=metrics,
    )
