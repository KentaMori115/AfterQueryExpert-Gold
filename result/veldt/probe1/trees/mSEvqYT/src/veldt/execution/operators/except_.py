"""The except operator."""

from __future__ import annotations

from collections import Counter
from typing import Iterator, List

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["ExceptOperator"]


class ExceptOperator(BinaryOperator):
    """Keeps left rows that do not appear in the right input.

    For ``EXCEPT DISTINCT`` (``all=False``) every surviving row appears once.
    For ``EXCEPT ALL`` (``all=True``) a row that appears *m* times on the left
    and *n* times on the right survives ``max(m - n, 0)`` times.

    Output order follows the left-hand input; the right-hand input is fully
    buffered before any output is produced.  Each right-hand copy cancels the
    earliest left-hand copy still standing.
    """

    def __init__(self, left: Operator, right: Operator, schema: Schema, all: bool = False) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        # Buffer the entire right side into a row-key multiset.
        right_counts: Counter = Counter()
        for batch in self.right.execute(context):
            cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
            names = self._schema.names
            for row_idx in range(cast_batch.num_rows):
                key = row_key(cast_batch.column(name)[row_idx] for name in names)
                right_counts[key] += 1

        # Stream through the left side, removing rows that appeared on the right.
        if self._all:
            # For EXCEPT ALL: each right-side copy cancels one left-side copy.
            cancelled: Counter = Counter()
            for batch in self.left.execute(context):
                cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
                names = self._schema.names
                mask: List[bool] = []
                for row_idx in range(cast_batch.num_rows):
                    key = row_key(cast_batch.column(name)[row_idx] for name in names)
                    if cancelled[key] < right_counts[key]:
                        cancelled[key] += 1
                        mask.append(False)
                    else:
                        mask.append(True)
                kept = sum(1 for v in mask if v)
                if kept == cast_batch.num_rows:
                    yield cast_batch
                elif kept:
                    yield cast_batch.filter(mask)
        else:
            # For EXCEPT DISTINCT: emit the first occurrence of each key that
            # does NOT exist on the right side.
            emitted: set = set()
            for batch in self.left.execute(context):
                cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
                names = self._schema.names
                mask = []
                for row_idx in range(cast_batch.num_rows):
                    key = row_key(cast_batch.column(name)[row_idx] for name in names)
                    if key not in right_counts and key not in emitted:
                        emitted.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                kept = sum(1 for v in mask if v)
                if kept == cast_batch.num_rows:
                    yield cast_batch
                elif kept:
                    yield cast_batch.filter(mask)

    def describe(self) -> str:
        return "Except"
