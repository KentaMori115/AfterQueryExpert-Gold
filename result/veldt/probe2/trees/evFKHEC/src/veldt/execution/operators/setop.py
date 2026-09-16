"""The intersect and except operators.

Both pair rows between their two inputs, so both have to see the whole right
input before they can answer anything about the left one: they report as
blocking, while a plain concatenation does not.

Rows pair by value and by type, after both sides have been cast to the common
output schema. ``1`` on one side and ``1.0`` on the other therefore pair once
the shared schema makes them both floats, and two nulls pair, which a
comparison between them would not.

Output follows the order of the left input. Under ``ALL`` each copy the right
input supplied cancels the earliest surviving copy on the left.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]

RowKey = Tuple


class PairingOperator(BinaryOperator):
    """Shared machinery for the two pairing set operators.

    Subclasses decide what to do with one left row given how many copies of it
    the right input still has to spend.
    """

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

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._right_counts(context)
        emitted: Set[RowKey] = set()
        for batch in self.left.execute(context):
            conformed = self._conform(batch)
            mask: List[bool] = [
                self._keep(key, counts, emitted) for key in self._keys(conformed)
            ]
            kept = sum(1 for value in mask if value)
            if kept == conformed.num_rows:
                yield conformed
            elif kept:
                yield conformed.filter(mask)
            context.metrics.increment(
                f"{self.name}.rows_dropped", conformed.num_rows - kept
            )

    def _right_counts(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Count how many times the right input produced each row."""
        counts: Dict[RowKey, int] = {}
        for batch in self.right.execute(context):
            for key in self._keys(self._conform(batch)):
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _conform(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so both sides compare alike."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keys(self, batch: RecordBatch) -> Iterator[RowKey]:
        columns = [batch.column(name) for name in self._schema.names]
        for row in range(batch.num_rows):
            yield row_key(column[row] for column in columns)

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide whether one left row survives, updating the bookkeeping."""
        raise NotImplementedError

    def _once(self, key: RowKey, emitted: Set[RowKey]) -> bool:
        """True the first time a key is offered, false afterwards."""
        if key in emitted:
            return False
        emitted.add(key)
        return True


class IntersectOperator(PairingOperator):
    """Emits rows both inputs produced.

    ``ALL`` emits a row ``min(m, n)`` times for ``m`` copies on the left and
    ``n`` on the right; the plain form emits each such row once.
    """

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if available == 0:
            return False
        if not self.all:
            return self._once(key, emitted)
        counts[key] = available - 1
        return True

    def describe(self) -> str:
        return "Intersect: all" if self.all else "Intersect: distinct"


class ExceptOperator(PairingOperator):
    """Emits left rows the right input never produced.

    ``ALL`` emits a row ``max(m - n, 0)`` times for ``m`` copies on the left
    and ``n`` on the right; the plain form emits each left row absent from the
    right input once.
    """

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if available:
            if self.all:
                counts[key] = available - 1
            return False
        if not self.all:
            return self._once(key, emitted)
        return True

    def describe(self) -> str:
        return "Except: all" if self.all else "Except: distinct"
