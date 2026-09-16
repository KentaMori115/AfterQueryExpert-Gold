"""The intersect and except operators.

Both pair rows between their two inputs, so both have to see the whole right
input before they can answer for a single left row: they buffer the right side
into a multiset of row keys and then stream the left side against it. That makes
them blocking, unlike the union operator, which only concatenates.

Rows pair by value and by type, on the *converted* values: each side is cast to
the operator's output schema first, so an ``int64`` ``1`` and a ``float64``
``1.0`` become the same row. Two nulls pair, which a comparison between them
would not.
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


class SetOperator(BinaryOperator):
    """Shared machinery for the pairing set operators.

    Subclasses decide one thing: whether a left row survives, given how many
    copies of it the right input still has to spend.
    """

    keyword = "set"

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
        remaining = self._right_counts(context)
        emitted: Set[RowKey] = set()
        names = self._schema.names
        for batch in self.left.execute(context):
            converted = self._convert(batch)
            columns = [converted.column(name) for name in names]
            mask: List[bool] = []
            for row in range(converted.num_rows):
                key = row_key(column[row] for column in columns)
                mask.append(self._keep(key, remaining, emitted))
            kept = sum(1 for value in mask if value)
            if kept == converted.num_rows:
                yield converted
            elif kept:
                yield converted.filter(mask)
            context.metrics.increment(
                f"{self.keyword}.rows_dropped", converted.num_rows - kept
            )

    def _right_counts(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Count how many times the right input produces each row."""
        counts: Dict[RowKey, int] = {}
        names = self._schema.names
        for batch in self.right.execute(context):
            converted = self._convert(batch)
            columns = [converted.column(name) for name in names]
            for row in range(converted.num_rows):
                key = row_key(column[row] for column in columns)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _convert(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so both sides compare alike."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keep(
        self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide one left row, consuming a right-hand copy if it pairs."""
        raise NotImplementedError

    def describe(self) -> str:
        return f"{self.keyword.capitalize()}: {'all' if self.all else 'distinct'}"


class IntersectOperator(SetOperator):
    """Keeps left rows the right input also produced.

    With ``ALL``, a row supplied ``m`` times on the left and ``n`` times on the
    right survives ``min(m, n)`` times: each right-hand copy pairs with the
    earliest left copy still standing. Without it, each row the two sides share
    is emitted once, in left order.
    """

    keyword = "intersect"

    def _keep(
        self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        if remaining.get(key, 0) <= 0:
            return False
        if self.all:
            remaining[key] -= 1
            return True
        if key in emitted:
            return False
        emitted.add(key)
        return True


class ExceptOperator(SetOperator):
    """Keeps left rows the right input never produced.

    With ``ALL``, a row supplied ``m`` times on the left and ``n`` times on the
    right survives ``max(m - n, 0)`` times, each right-hand copy cancelling the
    earliest left copy still standing. Without it, a row survives once, and only
    when the right input never produced it at all.
    """

    keyword = "except"

    def _keep(
        self, key: RowKey, remaining: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        if remaining.get(key, 0) > 0:
            if self.all:
                remaining[key] -= 1
            return False
        if self.all:
            return True
        if key in emitted:
            return False
        emitted.add(key)
        return True
