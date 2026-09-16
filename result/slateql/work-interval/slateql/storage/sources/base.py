"""The data source interface.

A source is anything that can describe a schema and produce rows.  Sources are
re-scannable: calling :meth:`DataSource.scan` twice must produce the same rows
in the same order, which is what makes query results deterministic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterator, Optional, Sequence

from ...types.schema import Schema

__all__ = ["DataSource", "ProjectionPushdown"]


class DataSource(ABC):
    """Abstract base class for every table backend."""

    @property
    @abstractmethod
    def schema(self) -> Schema:
        """The columns this source produces, in physical order."""

    @abstractmethod
    def scan(self, projection: Optional[Sequence[int]] = None) -> Iterator[list[Any]]:
        """Yield rows as lists.

        ``projection`` selects and orders the columns to emit.  Implementations
        that cannot push a projection down should call
        :meth:`apply_projection` on each full row.
        """

    @property
    def name(self) -> str:
        """A short label used in EXPLAIN output and error messages."""

        return type(self).__name__

    def row_count(self) -> Optional[int]:
        """Exact row count when known cheaply, else ``None``.

        The planner treats ``None`` as "unknown" and falls back to a default
        cardinality estimate rather than scanning the source.
        """

        return None

    def supports_projection(self) -> bool:
        """Whether :meth:`scan` handles ``projection`` natively."""

        return True

    def apply_projection(
        self, row: Sequence[Any], projection: Optional[Sequence[int]]
    ) -> list[Any]:
        """Reduce a full row to the requested columns."""

        if projection is None:
            return list(row)
        return [row[index] for index in projection]

    def materialize(self, projection: Optional[Sequence[int]] = None) -> list[list[Any]]:
        """Read the whole source into memory.  Used by tests and by ``load``."""

        return list(self.scan(projection))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}(columns={len(self.schema)})"


class ProjectionPushdown:
    """Mixin resolving a projection into a reusable index list.

    Sources that read structured records (CSV, JSONL) use this to translate a
    projection into the field offsets they should keep, once, instead of per
    row.
    """

    def resolve_projection(
        self, schema: Schema, projection: Optional[Sequence[int]]
    ) -> Optional[list[int]]:
        if projection is None:
            return None
        width = len(schema)
        resolved: list[int] = []
        for index in projection:
            if index < 0 or index >= width:
                raise IndexError(
                    f"projection index {index} out of range for {width} columns"
                )
            resolved.append(index)
        return resolved
