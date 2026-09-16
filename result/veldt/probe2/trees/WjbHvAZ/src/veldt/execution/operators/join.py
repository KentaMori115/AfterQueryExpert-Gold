"""Join operators.

Two implementations cover every join the planner can produce:

:class:`HashJoinOperator`
    Used when the condition contains at least one equality between a column of
    the left input and a column of the right. The right side is buffered into a
    hash table keyed by those columns, then the left side probes it. Any part
    of the condition that is not an equi-key becomes a residual predicate
    checked on each candidate pair.

:class:`NestedLoopJoinOperator`
    The fallback for cross joins and for conditions with no usable equality.

Both share the null rules SQL demands: a null key never matches anything, not
even another null, and an outer join emits a null-extended row for every input
row that found no partner.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from ...core.batch import RecordBatch
from ...core.table import Table
from ...errors import ExecutionError
from ...expr.ast import Expression
from ...types.schema import Schema
from ...types.value import coerce_bool, is_null
from ...utils.hashing import value_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["HashJoinOperator", "NestedLoopJoinOperator", "JOIN_TYPES"]

JOIN_TYPES = ("inner", "left", "right", "full", "cross")


class _JoinBase(BinaryOperator):
    """Shared machinery for the two join implementations."""

    def __init__(
        self,
        left: Operator,
        right: Operator,
        schema: Schema,
        how: str = "inner",
        residual: Optional[Expression] = None,
    ) -> None:
        super().__init__(left, right)
        if how not in JOIN_TYPES:
            raise ExecutionError(f"unknown join type {how!r}")
        self._schema = schema
        self.how = how
        self.residual = residual
        self._left_width = len(left.schema)
        self._right_width = len(right.schema)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def is_blocking(self) -> bool:
        return True

    @property
    def emits_unmatched_left(self) -> bool:
        """True when left rows without a partner still appear in the output."""
        return self.how in ("left", "full")

    @property
    def emits_unmatched_right(self) -> bool:
        """True when right rows without a partner still appear in the output."""
        return self.how in ("right", "full")

    def _null_left(self) -> Tuple[Any, ...]:
        return (None,) * self._left_width

    def _null_right(self) -> Tuple[Any, ...]:
        return (None,) * self._right_width

    def _passes_residual(self, row: Sequence[Any], context: ExecutionContext) -> bool:
        """Evaluate the non-equi part of the condition on one candidate row."""
        if self.residual is None:
            return True
        batch = RecordBatch.from_rows(self._schema, [tuple(row)])
        column = context.evaluator.evaluate(self.residual, batch)
        return coerce_bool(column[0]) is True

    def _emit(self, rows: List[tuple], context: ExecutionContext) -> Iterator[RecordBatch]:
        """Chunk assembled rows into output batches."""
        for start in range(0, len(rows), context.batch_size):
            yield RecordBatch.from_rows(self._schema, rows[start : start + context.batch_size])

    def _materialize(self, operator: Operator, context: ExecutionContext) -> List[tuple]:
        """Read one side fully into a list of row tuples."""
        collected: List[tuple] = []
        for batch in operator.execute(context):
            collected.extend(batch.tuples())
        return collected


class HashJoinOperator(_JoinBase):
    """Equi-join built on a hash table over the right input."""

    def __init__(
        self,
        left: Operator,
        right: Operator,
        schema: Schema,
        keys: Sequence[Tuple[Expression, Expression]],
        how: str = "inner",
        residual: Optional[Expression] = None,
    ) -> None:
        super().__init__(left, right, schema, how, residual)
        if not keys:
            raise ExecutionError("a hash join requires at least one equality key")
        self.keys = tuple(keys)

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        build_rows, index = self._build(context)
        context.metrics.increment("join.build_rows", len(build_rows))
        matched_right: set = set()
        output: List[tuple] = []

        for batch in self.left.execute(context):
            key_columns = [
                context.evaluator.evaluate(left_key, batch) for left_key, _ in self.keys
            ]
            for row in range(batch.num_rows):
                left_values = batch.row_tuple(row)
                key = self._probe_key(key_columns, row)
                candidates = index.get(key, ()) if key is not None else ()
                found = False
                for position in candidates:
                    combined = left_values + build_rows[position]
                    if not self._passes_residual(combined, context):
                        continue
                    found = True
                    matched_right.add(position)
                    output.append(combined)
                if not found and self.emits_unmatched_left:
                    output.append(left_values + self._null_right())
            if len(output) >= context.batch_size:
                yield from self._emit(output, context)
                output = []

        if self.emits_unmatched_right:
            for position, values in enumerate(build_rows):
                if position not in matched_right:
                    output.append(self._null_left() + values)
        if output:
            yield from self._emit(output, context)

    def _build(
        self, context: ExecutionContext
    ) -> Tuple[List[tuple], Dict[tuple, List[int]]]:
        """Buffer the right input and index it by the join keys."""
        rows: List[tuple] = []
        index: Dict[tuple, List[int]] = {}
        for batch in self.right.execute(context):
            key_columns = [
                context.evaluator.evaluate(right_key, batch) for _, right_key in self.keys
            ]
            offset = len(rows)
            rows.extend(batch.tuples())
            for row in range(batch.num_rows):
                key = self._probe_key(key_columns, row)
                if key is None:
                    continue
                index.setdefault(key, []).append(offset + row)
        return rows, index

    @staticmethod
    def _probe_key(columns: Sequence[Any], row: int) -> Optional[tuple]:
        """Build a lookup key, or ``None`` when any part of it is null."""
        values = []
        for column in columns:
            value = column[row]
            if is_null(value):
                return None
            values.append(value_key(value))
        return tuple(values)

    def describe(self) -> str:
        keys = ", ".join(
            f"{left.to_sql()} = {right.to_sql()}" for left, right in self.keys
        )
        suffix = f" residual={self.residual.to_sql()}" if self.residual else ""
        return f"HashJoin(how={self.how}, on=[{keys}]{suffix})"


class NestedLoopJoinOperator(_JoinBase):
    """Join that compares every left row against every right row.

    This is the only correct choice for a cross join, and the only available
    one for a condition with no equality between the two sides.
    """

    def __init__(
        self,
        left: Operator,
        right: Operator,
        schema: Schema,
        condition: Optional[Expression] = None,
        how: str = "inner",
    ) -> None:
        super().__init__(left, right, schema, how, condition)
        if how == "cross" and condition is not None:
            raise ExecutionError("a cross join must not have a condition")

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        build_rows = self._materialize(self.right, context)
        context.metrics.increment("join.build_rows", len(build_rows))
        matched_right: set = set()
        output: List[tuple] = []

        for batch in self.left.execute(context):
            for row in range(batch.num_rows):
                left_values = batch.row_tuple(row)
                found = False
                for position, right_values in enumerate(build_rows):
                    combined = left_values + right_values
                    if not self._passes_residual(combined, context):
                        continue
                    found = True
                    matched_right.add(position)
                    output.append(combined)
                if not found and self.emits_unmatched_left:
                    output.append(left_values + self._null_right())
            if len(output) >= context.batch_size:
                yield from self._emit(output, context)
                output = []

        if self.emits_unmatched_right:
            for position, values in enumerate(build_rows):
                if position not in matched_right:
                    output.append(self._null_left() + values)
        if output:
            yield from self._emit(output, context)

    def describe(self) -> str:
        if self.residual is None:
            return f"NestedLoopJoin(how={self.how})"
        return f"NestedLoopJoin(how={self.how}, on={self.residual.to_sql()})"
