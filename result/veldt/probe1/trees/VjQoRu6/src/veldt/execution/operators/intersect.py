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


class IntersectOperator(BinaryOperator):
    """Keeps rows that appear in both inputs.

    The right-hand side is materialised into a multiset (Counter) keyed by
    the row's value+type fingerprint.  Each key encodes type information so
    that integer ``1`` and float ``1.0`` are treated as distinct values when
    *comparing*, but are unified to the combined schema's type before the key
    is computed — matching the specification that "integer 1 on one side is
    the same row as float 1.0 on the other" once both branches have been cast
    to the common type.

    For plain ``INTERSECT`` (distinct) the multiplicity on the right is
    treated as a boolean: any presence is enough.  For ``INTERSECT ALL`` the
    multiplicity from the right caps how many left-side copies survive.
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
        # Materialise the right side, cast to the common schema.
        right_counts: Counter = Counter()
        for batch in self.right.execute(context):
            cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
            for row in range(cast_batch.num_rows):
                key = row_key(
                    cast_batch.column(name)[row] for name in self._schema.names
                )
                right_counts[key] += 1

        # For plain INTERSECT treat the right as a boolean presence set.
        if not self._all:
            right_set = frozenset(right_counts)
        else:
            right_set = None  # unused when _all is True; use right_counts

        # Stream the left side, keeping rows present on the right.
        # For ALL we also maintain a "used" counter so that left copies beyond
        # min(m, n) are dropped.
        # For plain INTERSECT we additionally deduplicate: once a key has been
        # emitted it is removed from right_set so a second left copy won't match.
        used_counts: Counter = Counter()
        if not self._all:
            # Make a mutable copy so we can remove keys as they are emitted.
            seen: set = set()
        else:
            seen = None  # type: ignore[assignment]

        for batch in self.left.execute(context):
            cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
            mask = []
            for row in range(cast_batch.num_rows):
                key = row_key(
                    cast_batch.column(name)[row] for name in self._schema.names
                )
                if self._all:
                    available = right_counts[key] - used_counts[key]
                    if available > 0:
                        used_counts[key] += 1
                        mask.append(True)
                    else:
                        mask.append(False)
                else:
                    # Distinct: row must be in the right set AND not yet emitted.
                    if key in right_set and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)

            kept = sum(1 for v in mask if v)
            context.metrics.increment("intersect.rows_dropped", cast_batch.num_rows - kept)
            if kept == cast_batch.num_rows:
                yield cast_batch
            elif kept:
                yield cast_batch.filter(mask)

    def describe(self) -> str:
        return "Intersect: all" if self._all else "Intersect: distinct"


class ExceptOperator(BinaryOperator):
    """Keeps left-side rows that do not appear on the right.

    The right-hand side is materialised into a multiset (Counter).  For plain
    ``EXCEPT`` (distinct) a row is dropped if it appears at all on the right.
    For ``EXCEPT ALL`` the right-side multiplicity reduces how many left-side
    copies survive: a row that appears *m* times on the left and *n* times on
    the right yields ``max(m - n, 0)`` surviving rows, preserving left order
    and cancelling the earliest copies first.
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
        # Materialise the right side.
        right_counts: Counter = Counter()
        for batch in self.right.execute(context):
            cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
            for row in range(cast_batch.num_rows):
                key = row_key(
                    cast_batch.column(name)[row] for name in self._schema.names
                )
                right_counts[key] += 1

        if not self._all:
            right_set = frozenset(right_counts)
        else:
            right_set = None

        # Stream the left side, cancelling copies present on the right.
        # For ALL, "cancelled" tracks how many left copies have been cancelled
        # so far for each key.  Each cancel removes the earliest left copy.
        # For plain EXCEPT we additionally deduplicate: each distinct surviving
        # key is emitted at most once.
        cancelled: Counter = Counter()
        if not self._all:
            seen: set = set()
        else:
            seen = None  # type: ignore[assignment]

        for batch in self.left.execute(context):
            cast_batch = batch if batch.schema == self._schema else batch.cast(self._schema)
            mask = []
            for row in range(cast_batch.num_rows):
                key = row_key(
                    cast_batch.column(name)[row] for name in self._schema.names
                )
                if self._all:
                    if cancelled[key] < right_counts[key]:
                        # This left copy is cancelled by a right copy.
                        cancelled[key] += 1
                        mask.append(False)
                    else:
                        mask.append(True)
                else:
                    # Distinct: row must not appear on the right AND not yet emitted.
                    if key not in right_set and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)

            kept = sum(1 for v in mask if v)
            context.metrics.increment("except.rows_dropped", cast_batch.num_rows - kept)
            if kept == cast_batch.num_rows:
                yield cast_batch
            elif kept:
                yield cast_batch.filter(mask)

    def describe(self) -> str:
        return "Except: all" if self._all else "Except: distinct"
