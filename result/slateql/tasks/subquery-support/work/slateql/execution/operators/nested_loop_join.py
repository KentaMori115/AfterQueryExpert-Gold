"""Nested-loop join.

Used for cross joins and for join conditions the planner cannot turn into
equality keys.  The right input is materialised once and re-scanned for every
left row, so the operator is quadratic; the planner only chooses it when no
hash join is possible.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional

from ...plan.expressions import Expr
from ...sql.ast_nodes import JoinKind
from ...types.schema import Schema
from ..batch import RecordBatch, batches_from_rows
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from .base import BinaryOperator, Operator
from .hash_join import _join_schema

__all__ = ["NestedLoopJoinOperator"]


class NestedLoopJoinOperator(BinaryOperator):
    """Joins every left row against every right row, filtering by condition."""

    def __init__(
        self,
        kind: JoinKind,
        left: Operator,
        right: Operator,
        condition: Optional[Expr] = None,
    ) -> None:
        super().__init__(left, right)
        self._kind = kind
        self._condition = condition
        self._schema = _join_schema(kind, left.schema, right.schema)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def kind(self) -> JoinKind:
        return self._kind

    def describe(self) -> str:
        text = f"NestedLoopJoin {self._kind.value}"
        if self._condition is not None:
            text += f" on {self._condition.to_sql()}"
        return text

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        right_rows: list[list[Any]] = []
        for batch in self.right.execute(context):
            right_rows.extend(batch.rows)

        predicate = None
        if self._condition is not None:
            evaluator = ExpressionEvaluator(
                context.registry,
                strict_casts=context.strict_casts,
                context=context,
            )
            predicate = evaluator.compile_predicate(
                self._condition, self.left.schema.merge(self.right.schema)
            )

        right_width = len(self.right.schema)
        left_width = len(self.left.schema)
        right_nulls = [None] * right_width
        left_nulls = [None] * left_width
        matched_right: set[int] = set()
        emit_unmatched_left = self._kind in (JoinKind.LEFT, JoinKind.FULL)

        out: list[list[Any]] = []
        for batch in self.left.execute(context):
            for left_row in batch.rows:
                found = False
                for offset, right_row in enumerate(right_rows):
                    combined = [*left_row, *right_row]
                    if predicate is not None and not predicate(combined):
                        continue
                    matched_right.add(offset)
                    found = True
                    out.append(combined)
                if not found and emit_unmatched_left:
                    out.append([*left_row, *right_nulls])
            if len(out) >= context.batch_size:
                yield from self._flush(out, context)
                out = []

        if self._kind in (JoinKind.RIGHT, JoinKind.FULL):
            for offset, right_row in enumerate(right_rows):
                if offset in matched_right:
                    continue
                out.append([*left_nulls, *right_row])

        yield from self._flush(out, context)

    def _flush(
        self, rows: list[list[Any]], context: ExecutionContext
    ) -> Iterator[RecordBatch]:
        if not rows:
            return
        for batch in batches_from_rows(self._schema, rows, context.batch_size):
            context.metrics.record_batch(len(batch))
            yield batch
