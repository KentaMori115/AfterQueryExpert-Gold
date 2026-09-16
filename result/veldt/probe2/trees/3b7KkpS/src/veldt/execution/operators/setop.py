"""The pairing set operators: ``INTERSECT`` and ``EXCEPT``.

Both answer the same question about a row — how many copies did the other side
produce? — so both start by draining the right input into a count per distinct
row. That makes them blocking: nothing can be emitted before the right side is
known. ``UNION`` never has to pair anything and stays streaming.

Rows pair by value and by type, after both inputs have been cast to the common
schema, so ``1`` and ``1.0`` are the same row once the pair of branches has
agreed on ``float64``. Two nulls pair, which a comparison between them would
not: this is row identity, not equality.

The plain spelling of each operator emits every surviving row once; the ``ALL``
spelling counts, so a row supplied ``m`` times on the left and ``n`` times on
the right survives ``min(m, n)`` times under ``INTERSECT`` and ``m - n`` times,
floored at zero, under ``EXCEPT``. Output follows the left input's order, and
each right-hand copy cancels the earliest left copy still standing.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]

RowKey = Tuple[Tuple[str, object], ...]


class _PairingSetOperator(BinaryOperator):
    """Shared machinery for the two operators that pair rows across inputs."""

    def __init__(
        self, left: Operator, right: Operator, schema: Schema, all: bool = False
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self.all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def is_blocking(self) -> bool:
        return True

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._right_counts(context)
        context.metrics.increment(f"{self.name}.right_rows", sum(counts.values()))
        emitted: Set[RowKey] = set()
        for batch in self.left.execute(context):
            typed = self._cast(batch)
            mask: List[bool] = [
                self._keep(row_key(values), counts, emitted)
                for values in typed.tuples()
            ]
            kept = sum(1 for value in mask if value)
            if kept == typed.num_rows:
                yield typed
            elif kept:
                yield typed.filter(mask)
            context.metrics.increment(f"{self.name}.rows_dropped", typed.num_rows - kept)

    def _right_counts(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Count how many times the right input produced each distinct row."""
        counts: Dict[RowKey, int] = {}
        for batch in self.right.execute(context):
            for values in self._cast(batch).tuples():
                key = row_key(values)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _cast(self, batch: RecordBatch) -> RecordBatch:
        """Bring a batch onto the common schema so rows compare like for like."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide whether one left row survives, updating the bookkeeping."""
        raise NotImplementedError

    def describe(self) -> str:
        return f"{self.name.replace('Operator', '')}: {'all' if self.all else 'distinct'}"


class IntersectOperator(_PairingSetOperator):
    """Emits the left rows the right input also produced."""

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


class ExceptOperator(_PairingSetOperator):
    """Emits the left rows the right input did not produce."""

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        remaining = counts.get(key, 0)
        if self.all:
            if remaining == 0:
                return True
            # This right-hand copy cancels the earliest left copy standing.
            counts[key] = remaining - 1
            return False
        if remaining or key in emitted:
            return False
        emitted.add(key)
        return True
