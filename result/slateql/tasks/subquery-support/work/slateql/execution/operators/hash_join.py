"""Hash join.

The right input is materialised into a hash table keyed by the equi-join
columns; the left input then streams through and probes it.  Building on the
right keeps the output column order (left columns first) identical to the
nested-loop implementation, so the planner can swap the two freely.

Rows whose key contains a NULL never match anything, matching SQL's rule that
``NULL = NULL`` is unknown.  Such rows still reach the outer-join padding path.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence

from ...errors import ExecutionError
from ...plan.expressions import Expr
from ...sql.ast_nodes import JoinKind
from ...types.schema import Schema
from ..batch import RecordBatch, batches_from_rows
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from ..keys import key_is_null_free, keys_for
from .base import BinaryOperator, Operator

__all__ = ["HashJoinOperator"]


class HashJoinOperator(BinaryOperator):
    """Equi-join with an optional residual predicate."""

    def __init__(
        self,
        kind: JoinKind,
        left: Operator,
        right: Operator,
        left_keys: Sequence[int],
        right_keys: Sequence[int],
        residual: Optional[Expr] = None,
    ) -> None:
        super().__init__(left, right)
        if len(left_keys) != len(right_keys):
            raise ExecutionError("hash join key lists must have equal length")
        if not left_keys:
            raise ExecutionError("hash join requires at least one equality key")
        self._kind = kind
        self._left_keys = tuple(left_keys)
        self._right_keys = tuple(right_keys)
        self._residual = residual
        self._schema = _join_schema(kind, left.schema, right.schema)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def kind(self) -> JoinKind:
        return self._kind

    def describe(self) -> str:
        keys = ", ".join(
            f"{self.left.schema[left].qualified_name}"
            f" = {self.right.schema[right].qualified_name}"
            for left, right in zip(self._left_keys, self._right_keys)
        )
        text = f"HashJoin {self._kind.value} on [{keys}]"
        if self._residual is not None:
            text += f" residual={self._residual.to_sql()}"
        return text

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        right_rows: list[list[Any]] = []
        buckets: dict[tuple, list[int]] = {}
        for batch in self.right.execute(context):
            for row in batch.rows:
                offset = len(right_rows)
                right_rows.append(row)
                key = keys_for(row, self._right_keys)
                if key_is_null_free(key):
                    buckets.setdefault(key, []).append(offset)

        residual = self._compile_residual(context)
        matched_right: set[int] = set()
        left_width = len(self.left.schema)
        right_width = len(self.right.schema)
        right_nulls = [None] * right_width
        left_nulls = [None] * left_width
        emit_unmatched_left = self._kind in (JoinKind.LEFT, JoinKind.FULL)

        out: list[list[Any]] = []
        for batch in self.left.execute(context):
            for left_row in batch.rows:
                key = keys_for(left_row, self._left_keys)
                candidates = buckets.get(key, ()) if key_is_null_free(key) else ()
                found = False
                for offset in candidates:
                    combined = [*left_row, *right_rows[offset]]
                    if residual is not None and not residual(combined):
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

    def _compile_residual(self, context: ExecutionContext):
        if self._residual is None:
            return None
        evaluator = ExpressionEvaluator(
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )
        combined = self.left.schema.merge(self.right.schema)
        return evaluator.compile_predicate(self._residual, combined)


def _join_schema(kind: JoinKind, left: Schema, right: Schema) -> Schema:
    """Output schema of a join, widening nullability on the padded side."""

    left_schema = left.with_nullable(True) if kind.keeps_right_nulls else left
    right_schema = right.with_nullable(True) if kind.keeps_left_nulls else right
    return left_schema.merge(right_schema)
