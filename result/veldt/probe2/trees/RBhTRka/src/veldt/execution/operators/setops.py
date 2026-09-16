"""The intersect and except operators.

Both pair rows between two inputs, so both must have the right input in hand
before they can answer for a single left row: they are blocking, where a plain
concatenation is not. The right side is drained once into a multiset of row
keys, then the left side streams past it, which keeps output in left order.

Rows pair by value and by type, on the combined schema both inputs are cast to,
so ``1`` and ``1.0`` are one row once both branches convert to ``float64``. Two
nulls pair, which a comparison between them would not.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["SetOperator", "IntersectOperator", "ExceptOperator"]

# What :func:`row_key` returns: one type-tagged key per column.
RowKey = Tuple[Tuple[str, Any], ...]


class SetOperator(BinaryOperator):
    """Shared machinery for the two pairing set operators."""

    # How the operator is spelled in SQL, used for plan output and metrics.
    label = "Set"

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
        return True

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide one left row, updating whatever state the decision consumes.

        ``counts`` is what the right input supplied and has not yet paired off;
        ``emitted`` is what the plain spelling has already returned.
        """
        raise NotImplementedError

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._count_right(context)
        emitted: Set[RowKey] = set()
        names = self._schema.names
        for batch in self.left.execute(context):
            batch = self._conform(batch)
            columns = [batch.column(name) for name in names]
            mask: List[bool] = []
            for row in range(batch.num_rows):
                key = row_key(column[row] for column in columns)
                mask.append(self._keep(key, counts, emitted))
            kept = sum(1 for value in mask if value)
            if kept == batch.num_rows:
                yield batch
            elif kept:
                yield batch.filter(mask)
            context.metrics.increment(
                f"{self.label.lower()}.rows_dropped", batch.num_rows - kept
            )

    def _count_right(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Drain the right input into a multiset of row keys."""
        counts: Dict[RowKey, int] = {}
        names = self._schema.names
        for batch in self.right.execute(context):
            batch = self._conform(batch)
            columns = [batch.column(name) for name in names]
            for row in range(batch.num_rows):
                key = row_key(column[row] for column in columns)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _conform(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the combined schema unless it already matches."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def describe(self) -> str:
        return f"{self.label}: {'all' if self.all else 'distinct'}"


class IntersectOperator(SetOperator):
    """Emits rows both inputs produced.

    ``INTERSECT ALL`` keeps ``min(m, n)`` copies of a row supplied ``m`` times
    on the left and ``n`` times on the right: each right-hand copy pairs with
    the earliest left copy still standing. Plain ``INTERSECT`` keeps one copy of
    every row that appears on both sides.
    """

    label = "Intersect"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if available <= 0:
            return False
        if self.all:
            counts[key] = available - 1
            return True
        if key in emitted:
            return False
        emitted.add(key)
        return True


class ExceptOperator(SetOperator):
    """Emits left rows the right input never produced.

    ``EXCEPT ALL`` keeps ``max(m - n, 0)`` copies: each right-hand copy cancels
    the earliest left copy still standing, so what survives is the tail of the
    left run. Plain ``EXCEPT`` keeps one copy of every left row the right side
    does not have at all.
    """

    label = "Except"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if self.all:
            if available > 0:
                counts[key] = available - 1
                return False
            return True
        if available > 0 or key in emitted:
            return False
        emitted.add(key)
        return True
