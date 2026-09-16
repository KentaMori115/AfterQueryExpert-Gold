"""The scan operator: the leaf of every plan."""

from __future__ import annotations

from typing import Iterator, List, Optional, Sequence

from ...core.batch import RecordBatch
from ...expr.ast import Expression
from ...storage.base import DataSource
from ...types.schema import Schema
from ..context import ExecutionContext
from .base import Operator

__all__ = ["ScanOperator"]


class ScanOperator(Operator):
    """Reads batches from a data source.

    Attributes:
        source: The source to read from.
        projection: Columns to read, or ``None`` for all of them.
        pushed_filters: Predicates the source accepted and will apply itself.
            They are recorded here for plan output only; the operator does not
            re-apply them.
    """

    def __init__(
        self,
        source: DataSource,
        projection: Optional[Sequence[str]] = None,
        pushed_filters: Sequence[Expression] = (),
        alias: Optional[str] = None,
    ) -> None:
        self.source = source
        self.projection = list(projection) if projection is not None else None
        self.pushed_filters = tuple(pushed_filters)
        self.alias = alias
        self._schema = source.projected_schema(self.projection)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def table_name(self) -> str:
        """The alias if one was given, otherwise the source's own name."""
        return self.alias or self.source.name

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        context.metrics.increment("scan.sources")
        for batch in self.source.scan(
            self.projection, context.batch_size, self.pushed_filters
        ):
            yield batch

    def describe(self) -> str:
        parts = [f"Scan({self.table_name})"]
        if self.projection is not None:
            parts.append(f"columns=[{', '.join(self.projection)}]")
        if self.pushed_filters:
            rendered = ", ".join(item.to_sql() for item in self.pushed_filters)
            parts.append(f"pushed=[{rendered}]")
        return " ".join(parts)
