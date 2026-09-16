"""Set-intersection and set-difference operators."""

from __future__ import annotations

from collections import Counter
from typing import Dict, Iterator, List, Tuple

from ...core.batch import RecordBatch
from ...types.schema import Schema
from ...utils.hashing import row_key
from ..context import ExecutionContext
from .base import BinaryOperator, Operator

__all__ = ["IntersectOperator", "ExceptOperator"]


def _collect_counts(operator: Operator, schema: Schema, context: ExecutionContext) -> Counter:
    """Materialise all rows from *operator* into a multiset keyed by row value.

    Rows are cast to *schema* before hashing so that an integer ``1`` on one
    side pairs correctly with a float ``1.0`` on the other.  Two ``NULL``
    values share the same key, which differs from the ``NULL <> NULL``
    semantics of a comparison predicate.
    """
    counts: Counter = Counter()
    for batch in operator.execute(context):
        casted = batch if batch.schema == schema else batch.cast(schema)
        for row in range(casted.num_rows):
            key = row_key(casted.column(field.name)[row] for field in schema)
            counts[key] += 1
    return counts


class IntersectOperator(BinaryOperator):
    """Produces the multiset intersection of two inputs.

    With ``all=False`` every surviving row appears once (``INTERSECT
    DISTINCT``).  With ``all=True`` a row that appears *m* times on the left
    and *n* times on the right survives ``min(m, n)`` times (``INTERSECT
    ALL``).

    Output follows left-hand input order; the right-hand side is fully
    materialised first so that the left side can be streamed batch-by-batch.
    """

    def __init__(
        self,
        left: Operator,
        right: Operator,
        schema: Schema,
        all: bool = False,
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        # Materialise the right side into a count map.
        right_counts = _collect_counts(self.right, self._schema, context)

        if self._all:
            # INTERSECT ALL: each key survives min(left_count, right_count) times.
            # We track how many right copies have been "used" so far.
            used: Counter = Counter()
            for batch in self.left.execute(context):
                casted = batch if batch.schema == self._schema else batch.cast(self._schema)
                mask: List[bool] = []
                for row in range(casted.num_rows):
                    key = row_key(casted.column(f.name)[row] for f in self._schema)
                    if used[key] < right_counts[key]:
                        used[key] += 1
                        mask.append(True)
                    else:
                        mask.append(False)
                yield from _apply_mask(batch, casted, mask)
        else:
            # INTERSECT DISTINCT: emit the first left-side occurrence of each key
            # that also appears on the right, then suppress further occurrences.
            seen: set = set()
            for batch in self.left.execute(context):
                casted = batch if batch.schema == self._schema else batch.cast(self._schema)
                mask = []
                for row in range(casted.num_rows):
                    key = row_key(casted.column(f.name)[row] for f in self._schema)
                    if key in right_counts and key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                yield from _apply_mask(batch, casted, mask)

    def describe(self) -> str:
        return "Intersect: all" if self._all else "Intersect: distinct"


class ExceptOperator(BinaryOperator):
    """Produces the multiset difference of two inputs (left minus right).

    With ``all=False`` every surviving row appears once (``EXCEPT DISTINCT``).
    With ``all=True`` a row that appears *m* times on the left and *n* times
    on the right survives ``max(m - n, 0)`` times (``EXCEPT ALL``).

    Output follows left-hand input order; the right-hand side is fully
    materialised first so that the left side can be streamed batch-by-batch.
    """

    def __init__(
        self,
        left: Operator,
        right: Operator,
        schema: Schema,
        all: bool = False,
    ) -> None:
        super().__init__(left, right)
        self._schema = schema
        self._all = all

    @property
    def schema(self) -> Schema:
        return self._schema

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        # Materialise the right side.
        right_counts = _collect_counts(self.right, self._schema, context)

        if self._all:
            # EXCEPT ALL: each copy on the right cancels the earliest left copy.
            cancelled: Counter = Counter()
            for batch in self.left.execute(context):
                casted = batch if batch.schema == self._schema else batch.cast(self._schema)
                mask: List[bool] = []
                for row in range(casted.num_rows):
                    key = row_key(casted.column(f.name)[row] for f in self._schema)
                    if cancelled[key] < right_counts[key]:
                        cancelled[key] += 1
                        mask.append(False)
                    else:
                        mask.append(True)
                yield from _apply_mask(batch, casted, mask)
        else:
            # EXCEPT DISTINCT: suppress ALL occurrences of any key present on
            # the right, keeping only the first occurrence of keys absent there.
            seen: set = set()
            for batch in self.left.execute(context):
                casted = batch if batch.schema == self._schema else batch.cast(self._schema)
                mask = []
                for row in range(casted.num_rows):
                    key = row_key(casted.column(f.name)[row] for f in self._schema)
                    if key in right_counts:
                        # Key exists on right: exclude entirely.
                        mask.append(False)
                    elif key not in seen:
                        seen.add(key)
                        mask.append(True)
                    else:
                        mask.append(False)
                yield from _apply_mask(batch, casted, mask)

    def describe(self) -> str:
        return "Except: all" if self._all else "Except: distinct"


def _apply_mask(
    original: RecordBatch,
    casted: RecordBatch,
    mask: List[bool],
) -> Iterator[RecordBatch]:
    """Yield a filtered batch using *original* schema when no rows survive,
    and the *casted* (combined) schema otherwise.

    We always emit from the *original* (left-side) batch so that column names
    come from the left, but we use *casted* keys for deduplication.  Since
    *casted* has the unified schema, we yield the casted batch filtered.
    """
    kept = sum(1 for v in mask if v)
    if kept == 0:
        return
    if kept == len(mask):
        yield casted
    else:
        yield casted.filter(mask)
