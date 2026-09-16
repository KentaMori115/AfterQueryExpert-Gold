"""The pairing set operators: ``INTERSECT`` and ``EXCEPT``.

Both operators answer a question about whole rows rather than about columns, so
both share the same shape: buffer the right input into a multiset of row keys,
then stream the left input and decide, row by row, whether the key still has a
partner on the right. Buffering the right side makes them blocking, unlike
:class:`~veldt.execution.operators.union.UnionOperator`, which only
concatenates and can stream.

Rows are compared the way ``DISTINCT`` compares them: by value *and* by type,
after both inputs have been cast to the operator's own schema. The cast is what
makes ``1`` and ``1.0`` the same row when one branch is integral and the other
is not, and two nulls are always the same row — which a comparison between them
would not be.
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

    metric_prefix = "setop"

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
        """True: the right input must be seen in full before answering."""
        return True

    def _conform(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so keys compare across inputs."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _right_counts(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Buffer the right input as a multiset of row keys."""
        counts: Dict[RowKey, int] = {}
        names = self._schema.names
        for batch in self.right.execute(context):
            batch = self._conform(batch)
            columns = [batch.column(name) for name in names]
            for row in range(batch.num_rows):
                key = row_key(column[row] for column in columns)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide one left row, updating whatever bookkeeping it consumes."""
        raise NotImplementedError

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._right_counts(context)
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
                f"{self.metric_prefix}.rows_dropped", batch.num_rows - kept
            )

    def describe(self) -> str:
        name = self.metric_prefix.capitalize()
        return f"{name}({'all' if self.all else 'distinct'})"


class IntersectOperator(_PairingSetOperator):
    """Emits the rows both inputs produced.

    With ``all`` a row supplied ``m`` times on the left and ``n`` times on the
    right is emitted ``min(m, n)`` times; without it once.
    """

    metric_prefix = "intersect"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        if counts.get(key, 0) <= 0:
            return False
        if not self.all:
            if key in emitted:
                return False
            emitted.add(key)
            return True
        counts[key] -= 1
        return True


class ExceptOperator(_PairingSetOperator):
    """Emits the left rows the right input never produced.

    With ``all`` a row supplied ``m`` times on the left and ``n`` times on the
    right is emitted ``max(m - n, 0)`` times, each right-hand copy cancelling
    the earliest left copy still standing; without it a row the right side
    produced at all is dropped, and every survivor is emitted once.
    """

    metric_prefix = "except"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        remaining = counts.get(key, 0)
        if not self.all:
            if remaining > 0 or key in emitted:
                return False
            emitted.add(key)
            return True
        if remaining > 0:
            counts[key] = remaining - 1
            return False
        return True
