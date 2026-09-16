"""The intersect and except operators.

Both compare whole rows against the other side, so both must draw the right
input in full before they can answer for a single left row: they are blocking,
where a union is not.

Rows are compared by value and by type, on batches already cast to the
operator's output schema. Casting first is what makes ``1`` on one side and
``1.0`` on the other the same row, and two nulls are the same row even though
comparing them would not say so.
"""

from __future__ import annotations

from collections import Counter
from typing import Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["SetOperator", "IntersectOperator", "ExceptOperator"]

RowKey = Tuple


class SetOperator(BinaryOperator):
    """Shared machinery for the two row-matching set operators.

    Subclasses decide, for one left row, whether it survives given how many
    copies of it the right side still has to spend and whether the row has
    been emitted already.
    """

    # Prefix used for the operator's metric keys.
    metric = "setop"

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

    def _keep(self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]) -> bool:
        """Decide one left row, updating the bookkeeping it consumes."""
        raise NotImplementedError

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        remaining = self._right_counts(context)
        emitted: Set[RowKey] = set()
        names = self._schema.names
        for batch in self.left.execute(context):
            batch = self._aligned(batch)
            columns = [batch.column(name) for name in names]
            mask: List[bool] = []
            for row in range(batch.num_rows):
                key = row_key(column[row] for column in columns)
                mask.append(self._keep(key, remaining, emitted))
            kept = sum(1 for value in mask if value)
            if kept == batch.num_rows:
                yield batch
            elif kept:
                yield batch.filter(mask)
            context.metrics.increment(
                f"{self.metric}.rows_dropped", batch.num_rows - kept
            )

    def _right_counts(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Count how many times the right input produced each row."""
        counts: Counter = Counter()
        names = self._schema.names
        for batch in self.right.execute(context):
            batch = self._aligned(batch)
            columns = [batch.column(name) for name in names]
            for row in range(batch.num_rows):
                counts[row_key(column[row] for column in columns)] += 1
        return counts

    def _aligned(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so both sides compare alike."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)


class IntersectOperator(SetOperator):
    """Emits the rows both inputs produced.

    With ``all``, a row supplied ``m`` times on the left and ``n`` times on the
    right is emitted ``min(m, n)`` times, earliest left copies first. Without
    it each matching row is emitted once.
    """

    metric = "intersect"

    def _keep(self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]) -> bool:
        available = remaining.get(key, 0)
        if available <= 0:
            return False
        if self.all:
            remaining[key] = available - 1
            return True
        if key in emitted:
            return False
        emitted.add(key)
        return True

    def describe(self) -> str:
        return "Intersect: all" if self.all else "Intersect: distinct"


class ExceptOperator(SetOperator):
    """Emits the left rows the right input did not produce.

    With ``all``, each right-hand copy of a row cancels the earliest left copy
    still standing, leaving ``max(m - n, 0)`` of them. Without it a row the
    right side produced at all is gone, and every survivor is emitted once.
    """

    metric = "except"

    def _keep(self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]) -> bool:
        available = remaining.get(key, 0)
        if self.all:
            if available > 0:
                remaining[key] = available - 1
                return False
            return True
        if available > 0 or key in emitted:
            return False
        emitted.add(key)
        return True

    def describe(self) -> str:
        return "Except: all" if self.all else "Except: distinct"
