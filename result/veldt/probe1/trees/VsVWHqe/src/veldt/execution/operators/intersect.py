"""The intersect and except operators."""

from __future__ import annotations

from collections import Counter
from typing import Iterator

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]


def _collect_counts(operator: Operator, schema: Schema, context: ExecutionContext) -> Counter:
    """Buffer one side into a Counter keyed by cast-normalised row tuples.

    Rows are cast to *schema* first so that ``int 1`` and ``float 1.0`` hash
    to the same key once both sides share a common type.  Two ``NULL`` values
    produce the same key, matching set-semantics.
    """
    counts: Counter = Counter()
    for batch in operator.execute(context):
        if batch.schema != schema:
            batch = batch.cast(schema)
        names = schema.names
        columns = [batch.column(name) for name in names]
        for row in range(batch.num_rows):
            key = row_key(col[row] for col in columns)
            counts[key] += 1
    return counts


class IntersectOperator(BinaryOperator):
    """Keeps rows that appear on both sides.

    *Distinct mode* (``INTERSECT``)
        Each row that appears in both inputs survives exactly once.

    *All mode* (``INTERSECT ALL``)
        A row that appears ``m`` times on the left and ``n`` times on the
        right survives ``min(m, n)`` times.  Output follows left-hand order
        and each right-hand copy cancels the earliest left copy still
        standing.
    """

    is_blocking = True

    def __init__(self, left: Operator, right: Operator, schema: Schema, all_: bool) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all_

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        right_counts = _collect_counts(self.right, self._schema, context)
        if not right_counts:
            return

        if self._all:
            # Multiset semantics: keep up to min(left_count, right_count) copies.
            # We materialise the left side so we can emit in left order.
            available: Counter = Counter(right_counts)
            for batch in self.left.execute(context):
                if batch.schema != self._schema:
                    batch = batch.cast(self._schema)
                names = self._schema.names
                columns = [batch.column(name) for name in names]
                mask = []
                for row in range(batch.num_rows):
                    key = row_key(col[row] for col in columns)
                    if available.get(key, 0) > 0:
                        available[key] -= 1
                        mask.append(True)
                    else:
                        mask.append(False)
                kept = sum(1 for v in mask if v)
                if kept == batch.num_rows:
                    yield batch
                elif kept:
                    yield batch.filter(mask)
        else:
            # Distinct mode: each row that exists on the right survives at most once.
            seen: set = set()
            right_set = set(right_counts.keys())
            for batch in self.left.execute(context):
                if batch.schema != self._schema:
                    batch = batch.cast(self._schema)
                names = self._schema.names
                columns = [batch.column(name) for name in names]
                mask = []
                for row in range(batch.num_rows):
                    key = row_key(col[row] for col in columns)
                    if key in right_set and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                kept = sum(1 for v in mask if v)
                if kept == batch.num_rows:
                    yield batch
                elif kept:
                    yield batch.filter(mask)

    def describe(self) -> str:
        return "Intersect"


class ExceptOperator(BinaryOperator):
    """Keeps left rows that do not appear in the right input.

    *Distinct mode* (``EXCEPT``)
        Each row that appears on the left but not on the right survives
        exactly once.

    *All mode* (``EXCEPT ALL``)
        A row that appears ``m`` times on the left and ``n`` times on the
        right survives ``max(0, m - n)`` times.  Output follows left-hand
        order and each right-hand copy cancels the earliest left copy still
        standing.
    """

    is_blocking = True

    def __init__(self, left: Operator, right: Operator, schema: Schema, all_: bool) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all_

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        right_counts = _collect_counts(self.right, self._schema, context)

        if self._all:
            # Multiset semantics: cancel up to n left copies for each right copy.
            available: Counter = Counter(right_counts)
            for batch in self.left.execute(context):
                if batch.schema != self._schema:
                    batch = batch.cast(self._schema)
                names = self._schema.names
                columns = [batch.column(name) for name in names]
                mask = []
                for row in range(batch.num_rows):
                    key = row_key(col[row] for col in columns)
                    if available.get(key, 0) > 0:
                        available[key] -= 1
                        mask.append(False)
                    else:
                        mask.append(True)
                kept = sum(1 for v in mask if v)
                if kept == batch.num_rows:
                    yield batch
                elif kept:
                    yield batch.filter(mask)
        else:
            # Distinct mode: emit rows not in the right set, at most once each.
            right_set = set(right_counts.keys())
            seen: set = set()
            for batch in self.left.execute(context):
                if batch.schema != self._schema:
                    batch = batch.cast(self._schema)
                names = self._schema.names
                columns = [batch.column(name) for name in names]
                mask = []
                for row in range(batch.num_rows):
                    key = row_key(col[row] for col in columns)
                    if key not in right_set and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                kept = sum(1 for v in mask if v)
                if kept == batch.num_rows:
                    yield batch
                elif kept:
                    yield batch.filter(mask)

    def describe(self) -> str:
        return "Except"
