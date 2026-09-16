"""The intersect and except operators."""

from __future__ import annotations

from typing import Dict, Iterator, List, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]


def _build_multiset(
    op: Operator, schema: Schema, context: ExecutionContext
) -> Dict[Tuple, int]:
    """Materialise one side of the operation into a row → count mapping.

    Rows are compared *after* casting to ``schema``, so an integer ``1`` and
    a float ``1.0`` are the same row once the unified schema is ``float64``.
    Two ``NULL`` values produce the same key (``("null", None)``).
    """
    counts: Dict[Tuple, int] = {}
    for batch in op.execute(context):
        cast_batch = batch if batch.schema == schema else batch.cast(schema)
        for row in range(cast_batch.num_rows):
            key = row_key(cast_batch.column(name)[row] for name in schema.names)
            counts[key] = counts.get(key, 0) + 1
    return counts


class IntersectOperator(BinaryOperator):
    """Emits rows that appear on both sides.

    ``all=False`` (distinct): each surviving row appears exactly once.
    ``all=True`` (multiset): a row that appears ``m`` times on the left and
    ``n`` times on the right survives ``min(m, n)`` times.  Output order
    follows the left input.
    """

    def __init__(
        self, left: Operator, right: Operator, schema: Schema, all: bool = False
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        # Build a multiset from the right input.
        right_counts = _build_multiset(self.right, self._schema, context)

        if self._all:
            # Keep min(m, n) copies of each row; track how many we've emitted.
            emitted: Dict[Tuple, int] = {}
            for batch in self.left.execute(context):
                cast_batch = (
                    batch if batch.schema == self._schema else batch.cast(self._schema)
                )
                mask: List[bool] = []
                for row in range(cast_batch.num_rows):
                    key = row_key(
                        cast_batch.column(name)[row] for name in self._schema.names
                    )
                    right_available = right_counts.get(key, 0)
                    already_emitted = emitted.get(key, 0)
                    if already_emitted < right_available:
                        emitted[key] = already_emitted + 1
                        mask.append(True)
                    else:
                        mask.append(False)
                yield _apply_mask(cast_batch, mask)
        else:
            # Distinct: each row at most once.
            seen: set = set()
            for batch in self.left.execute(context):
                cast_batch = (
                    batch if batch.schema == self._schema else batch.cast(self._schema)
                )
                mask = []
                for row in range(cast_batch.num_rows):
                    key = row_key(
                        cast_batch.column(name)[row] for name in self._schema.names
                    )
                    if key in right_counts and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                yield _apply_mask(cast_batch, mask)

    def describe(self) -> str:
        return "Intersect: all" if self._all else "Intersect: distinct"


class ExceptOperator(BinaryOperator):
    """Emits rows from the left input not present in the right input.

    ``all=False`` (distinct): each surviving row appears exactly once.
    ``all=True`` (multiset): a row that appears ``m`` times on the left and
    ``n`` times on the right survives ``max(m - n, 0)`` times.  Output order
    follows the left input; each right-hand copy cancels the earliest
    left-hand copy still standing.
    """

    def __init__(
        self, left: Operator, right: Operator, schema: Schema, all: bool = False
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        # Build a multiset from the right input.
        right_counts = _build_multiset(self.right, self._schema, context)

        if self._all:
            # Keep max(m - n, 0) copies; cancel earliest left copies first.
            cancelled: Dict[Tuple, int] = {}
            for batch in self.left.execute(context):
                cast_batch = (
                    batch if batch.schema == self._schema else batch.cast(self._schema)
                )
                mask: List[bool] = []
                for row in range(cast_batch.num_rows):
                    key = row_key(
                        cast_batch.column(name)[row] for name in self._schema.names
                    )
                    right_n = right_counts.get(key, 0)
                    already_cancelled = cancelled.get(key, 0)
                    if already_cancelled < right_n:
                        # This left copy is cancelled by a right copy.
                        cancelled[key] = already_cancelled + 1
                        mask.append(False)
                    else:
                        mask.append(True)
                yield _apply_mask(cast_batch, mask)
        else:
            # Distinct: each row at most once, only if absent from right.
            seen: set = set()
            for batch in self.left.execute(context):
                cast_batch = (
                    batch if batch.schema == self._schema else batch.cast(self._schema)
                )
                mask = []
                for row in range(cast_batch.num_rows):
                    key = row_key(
                        cast_batch.column(name)[row] for name in self._schema.names
                    )
                    if key not in right_counts and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                yield _apply_mask(cast_batch, mask)

    def describe(self) -> str:
        return "Except: all" if self._all else "Except: distinct"


def _apply_mask(batch: RecordBatch, mask: List[bool]) -> RecordBatch:
    """Return a batch filtered by ``mask``, or the original if all rows kept."""
    kept = sum(1 for v in mask if v)
    if kept == batch.num_rows:
        return batch
    return batch.filter(mask)
