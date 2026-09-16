"""The pairing set operators: ``INTERSECT`` and ``EXCEPT``.

Both operators answer a question about the *pair* of inputs — was this row
produced by the other side, and how often — so neither can emit anything before
it has counted the whole right input. That makes them blocking, unlike the
concatenating :class:`~veldt.execution.operators.union.UnionOperator`.

Rows are compared as whole rows after both sides have been cast to the
operator's output schema, by value and by type, using the same key function
``DISTINCT`` uses. So ``1`` on one side pairs with ``1.0`` on the other once the
common type has been applied, and two nulls pair even though comparing them
would not be true.

``ALL`` turns each operator into arithmetic on multiplicities: a row supplied
``m`` times on the left and ``n`` times on the right survives ``min(m, n)``
times under ``INTERSECT`` and ``max(m - n, 0)`` times under ``EXCEPT``. Output
follows the left input's order, each right-hand copy cancelling the earliest
left copy still standing. Without ``ALL`` every surviving row is emitted once,
at the position of its first surviving occurrence.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Set, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["SetOperator", "IntersectOperator", "ExceptOperator"]

RowKey = Tuple[Tuple[str, Any], ...]


class SetOperator(BinaryOperator):
    """Shared machinery for the two pairing set operators."""

    #: Prefix used for this operator's metric keys.
    metric_name = "setop"
    #: Name used when the operator is described in a plan dump.
    label = "SetOperation"

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
        """True: the right input has to be counted before anything is emitted."""
        return True

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        counts = self._count_right(context)
        emitted: Set[RowKey] = set()
        for batch in self.left.execute(context):
            casted = self._conform(batch)
            mask: List[bool] = []
            for key in _row_keys(casted):
                mask.append(self._keep(key, counts, emitted))
            kept = sum(1 for value in mask if value)
            if kept == casted.num_rows:
                yield casted
            elif kept:
                yield casted.filter(mask)
            context.metrics.increment(
                f"{self.metric_name}.rows_dropped", casted.num_rows - kept
            )

    def _count_right(self, context: ExecutionContext) -> Dict[RowKey, int]:
        """Count how often the right input produces each row."""
        counts: Dict[RowKey, int] = {}
        for batch in self.right.execute(context):
            for key in _row_keys(self._conform(batch)):
                counts[key] = counts.get(key, 0) + 1
        return counts

    def _conform(self, batch: RecordBatch) -> RecordBatch:
        """Cast a batch to the output schema so both sides compare alike."""
        return batch if batch.schema == self._schema else batch.cast(self._schema)

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        """Decide one left row, consuming a right-hand copy where that applies."""
        raise NotImplementedError

    def describe(self) -> str:
        return f"{self.label}: {'all' if self.all else 'distinct'}"


class IntersectOperator(SetOperator):
    """Emits the rows both inputs produced."""

    metric_name = "intersect"
    label = "Intersect"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if available == 0:
            return False
        if self.all:
            counts[key] = available - 1
            return True
        if key in emitted:
            return False
        emitted.add(key)
        return True


class ExceptOperator(SetOperator):
    """Emits the left rows the right input did not produce."""

    metric_name = "except"
    label = "Except"

    def _keep(
        self, key: RowKey, counts: Dict[RowKey, int], emitted: Set[RowKey]
    ) -> bool:
        available = counts.get(key, 0)
        if self.all:
            if available:
                counts[key] = available - 1
                return False
            return True
        if available or key in emitted:
            return False
        emitted.add(key)
        return True


def _row_keys(batch: RecordBatch) -> Iterator[RowKey]:
    """Yield one whole-row comparison key per row, in batch order."""
    columns = batch.columns
    for row in range(batch.num_rows):
        yield row_key(column[row] for column in columns)
