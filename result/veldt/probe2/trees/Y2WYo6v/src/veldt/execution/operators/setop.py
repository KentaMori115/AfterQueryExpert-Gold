"""The intersect and except operators.

Both pair rows between their two inputs, so both must have the right input in
hand before they can answer anything: they read it once, count what it
produced, and then stream the left input through that tally. A ``UNION`` needs
no such thing, which is why it lives in :mod:`veldt.execution.operators.union`
and stays streaming.

Rows pair by value and by type, once both sides have been cast to the common
output schema, so ``1`` and ``1.0`` are the same row and two nulls are the same
row — a pairing that a comparison between them would never make.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["SetOperator", "IntersectOperator", "ExceptOperator"]

RowKey = Tuple[Tuple[str, object], ...]


class SetOperator(BinaryOperator):
    """Shared machinery for the two pairing set operators.

    Output follows left order. With ``all`` the operators count: each copy the
    right input produced cancels the earliest left copy still standing. Without
    it every surviving row is emitted once.
    """

    kind = "SetOperator"

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
        """True: the right input has to be counted before a row can be judged."""
        return True

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._count_right(context)
        emitted: Set[RowKey] = set()
        for batch in self.left.execute(context):
            aligned = self._align(batch)
            columns = [aligned.column(name) for name in self._schema.names]
            mask: List[bool] = []
            for row in range(aligned.num_rows):
                key = row_key(column[row] for column in columns)
                mask.append(self._keep(key, counts, emitted))
            kept = sum(1 for value in mask if value)
            if kept == aligned.num_rows:
                yield aligned
            elif kept:
                yield aligned.filter(mask)
            context.metrics.increment(
                f"{self.kind.lower()}.rows_dropped", aligned.num_rows - kept
            )

    def _count_right(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Tally how many times the right input produced each row."""
        counts: Dict[RowKey, int] = {}
        for batch in self.right.execute(context):
            aligned = self._align(batch)
            columns = [aligned.column(name) for name in self._schema.names]
            for row in range(aligned.num_rows):
                key = row_key(column[row] for column in columns)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _align(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so both sides compare alike."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide one left row, consuming from ``counts`` as copies pair off."""
        raise NotImplementedError

    def describe(self) -> str:
        return f"{self.kind}: {'all' if self.all else 'distinct'}"


class IntersectOperator(SetOperator):
    """Keeps rows the right input produced too, ``min(m, n)`` of them."""

    kind = "Intersect"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        remaining = counts.get(key, 0)
        if self.all:
            if remaining == 0:
                return False
            counts[key] = remaining - 1
            return True
        if remaining == 0 or key in emitted:
            return False
        emitted.add(key)
        return True


class ExceptOperator(SetOperator):
    """Keeps left rows the right input did not produce, ``m - n`` of them."""

    kind = "Except"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        remaining = counts.get(key, 0)
        if self.all:
            if remaining:
                counts[key] = remaining - 1
                return False
            return True
        if remaining or key in emitted:
            return False
        emitted.add(key)
        return True
