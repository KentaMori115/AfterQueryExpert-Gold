"""The data source interface.

A data source is anything the engine can scan: an in-memory table, a CSV file,
a directory of partitioned files. Sources are responsible for their own schema
and for producing batches; everything above them in the stack only sees
:class:`~veldt.core.batch.RecordBatch` objects.

Two optional capabilities let a source do better than a naive full read:

``supports_filter_pushdown``
    Declares that the source can evaluate a particular predicate itself. The
    optimizer only hands a source predicates it has accepted, and the scan
    operator then trusts the source to have applied them.

``statistics``
    Supplies row counts used for cardinality estimation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterator, List, Optional, Sequence

from ..core.batch import RecordBatch
from ..core.table import DEFAULT_BATCH_SIZE, Table
from ..errors import DataSourceError
from ..expr.ast import Expression
from ..plan.stats import Statistics
from ..types.schema import Schema

__all__ = ["DataSource", "ScanOptions", "materialize"]


class ScanOptions:
    """Options passed to :meth:`DataSource.scan`.

    Attributes:
        projection: Column names to produce, or ``None`` for every column.
        batch_size: Maximum rows per emitted batch.
        filters: Predicates the source agreed to evaluate itself.
    """

    __slots__ = ("projection", "batch_size", "filters")

    def __init__(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> None:
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        self.projection = list(projection) if projection is not None else None
        self.batch_size = batch_size
        self.filters = tuple(filters)

    def describe(self) -> str:
        """Render the options for a plan dump."""
        parts = [f"batch_size={self.batch_size}"]
        if self.projection is not None:
            parts.append(f"projection=[{', '.join(self.projection)}]")
        if self.filters:
            parts.append(f"filters={len(self.filters)}")
        return " ".join(parts)


class DataSource(ABC):
    """Base class for everything the engine can read from."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The source's default table name."""

    @property
    @abstractmethod
    def schema(self) -> Schema:
        """The schema of the rows this source produces."""

    @abstractmethod
    def scan(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> Iterator[RecordBatch]:
        """Yield batches of rows.

        Implementations must respect ``projection`` — emitting a batch whose
        schema does not match the requested projection is an error the scan
        operator will not correct.
        """

    # ------------------------------------------------------------------
    # Optional capabilities
    # ------------------------------------------------------------------
    def supports_filter_pushdown(self, predicate: Expression) -> bool:
        """Whether this source can evaluate ``predicate`` itself.

        The default is ``False``: sources opt in explicitly, because accepting
        a predicate is a promise to apply it.
        """
        return False

    def statistics(self) -> Statistics:
        """Return what the source knows about its own size."""
        return Statistics(None)

    def close(self) -> None:
        """Release any resources the source holds. Idempotent."""

    # ------------------------------------------------------------------
    # Conveniences
    # ------------------------------------------------------------------
    def projected_schema(self, projection: Optional[Sequence[str]]) -> Schema:
        """Return the schema for a projection, validating the names.

        Raises:
            DataSourceError: If a requested column does not exist.
        """
        if projection is None:
            return self.schema
        missing = [name for name in projection if not self.schema.has(name)]
        if missing:
            raise DataSourceError(
                f"{self.name}: unknown column(s) {', '.join(missing)}"
            )
        return self.schema.select(list(projection))

    def to_table(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> Table:
        """Read the whole source into memory."""
        batches = list(self.scan(projection, batch_size))
        return Table(self.projected_schema(projection), batches)

    def head(self, count: int = 10) -> Table:
        """Read at most ``count`` rows without scanning the rest."""
        collected: List[RecordBatch] = []
        remaining = count
        for batch in self.scan(batch_size=max(min(count, DEFAULT_BATCH_SIZE), 1)):
            if remaining <= 0:
                break
            collected.append(batch if batch.num_rows <= remaining else batch.slice(0, remaining))
            remaining -= collected[-1].num_rows
        return Table(self.schema, collected)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.name!r}, {len(self.schema)} columns)"


def materialize(
    source: DataSource,
    projection: Optional[Sequence[str]] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Table:
    """Read a source fully into a :class:`~veldt.core.table.Table`."""
    return source.to_table(projection, batch_size)
