"""The intersection and difference operators.

Both pair whole rows across two inputs, and both answer the same question of
every row on the left: how many copies of it did the right side supply? So the
right input is drained first into a tally, and the left is then streamed
against it, one batch at a time.

Pairing is by value and by type, through the same key function grouping and
``DISTINCT`` use, with one difference that matters: both inputs are cast to the
combined schema before a key is taken. A ``1`` read as an integer on one side
and a ``1.0`` read as a float on the other are the same row once the two
branches have agreed on a type, and they would not be otherwise.

Two nulls pair with each other here. That is not the comparison operator's
answer, but it is the one set operations want, and it falls out of keying a row
rather than comparing it.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]

RowKey = Tuple


class _SetOperationOperator(BinaryOperator):
    """Shared machinery for the two row-pairing set operations."""

    #: Metric prefix and the word the operator describes itself with.
    keyword = ""

    def __init__(
        self, left: Operator, right: Operator, schema: Schema, all_rows: bool = False
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self.all = all_rows

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def is_blocking(self) -> bool:
        """True: nothing is emitted until the right input has been read."""
        return True

    def _align(self, batch: RecordBatch) -> RecordBatch:
        """Return ``batch`` in the common schema, casting only when it differs."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keys(self, batch: RecordBatch) -> List[RowKey]:
        """Return one pairing key per row of an already aligned batch."""
        columns = [batch.column(index) for index in range(len(self._schema))]
        return [row_key(column[row] for column in columns) for row in range(batch.num_rows)]

    def _tally(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Drain the right input, counting how often each row arrived."""
        counts: Dict[RowKey, int] = {}
        for batch in self.right.execute(context):
            for key in self._keys(self._align(batch)):
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _keep(self, key: RowKey, counts: Dict[RowKey, int], emitted: set) -> bool:
        """Decide one row. Subclasses answer; both may spend a counted copy."""
        raise NotImplementedError

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._tally(context)
        emitted: set = set()
        for batch in self.left.execute(context):
            aligned = self._align(batch)
            mask: List[bool] = [
                self._keep(key, counts, emitted) for key in self._keys(aligned)
            ]
            kept = sum(1 for flag in mask if flag)
            if kept == aligned.num_rows:
                yield aligned
            elif kept:
                yield aligned.filter(mask)
            context.metrics.increment(
                f"{self.keyword}.rows_dropped", aligned.num_rows - kept
            )

    def describe(self) -> str:
        word = "all" if self.all else "distinct"
        return f"{self.keyword.capitalize()}: {word}"


class IntersectOperator(_SetOperationOperator):
    """Emits the rows the right input also produced.

    Without ``all`` each surviving row appears once, at the position of its
    first occurrence on the left. With it, a row the left side supplied ``m``
    times and the right side ``n`` times appears ``min(m, n)`` times: every
    copy on the right pairs off one copy on the left, earliest first, and a
    left copy with nothing left to pair against is dropped.
    """

    keyword = "intersect"

    def _keep(self, key: RowKey, counts: Dict[RowKey, int], emitted: set) -> bool:
        if not self.all:
            if key in emitted or counts.get(key, 0) == 0:
                return False
            emitted.add(key)
            return True
        remaining = counts.get(key, 0)
        if remaining == 0:
            return False
        counts[key] = remaining - 1
        return True


class ExceptOperator(_SetOperationOperator):
    """Emits the left input's rows the right input did not cancel.

    Without ``all`` a row survives when the right side never produced it, and
    appears once. With it, a row the left side supplied ``m`` times and the
    right side ``n`` times appears ``max(m - n, 0)`` times: each copy on the
    right cancels the earliest copy still standing on the left, so what comes
    out is the tail of that row's run.
    """

    keyword = "except"

    def _keep(self, key: RowKey, counts: Dict[RowKey, int], emitted: set) -> bool:
        if not self.all:
            if key in emitted or counts.get(key, 0) > 0:
                return False
            emitted.add(key)
            return True
        remaining = counts.get(key, 0)
        if remaining == 0:
            return True
        counts[key] = remaining - 1
        return False
