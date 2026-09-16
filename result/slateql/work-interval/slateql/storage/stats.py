"""Table and column statistics used for cost estimation.

Statistics are optional: the planner degrades to fixed default estimates when
none are available.  They are computed by an explicit ``ANALYZE`` style call
rather than automatically, so that merely registering a large file never
triggers a full scan.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from ..types.schema import Schema
from ..util.ordering import compare_values

__all__ = ["ColumnStatistics", "TableStatistics", "compute_statistics"]

_MAX_TRACKED_DISTINCT = 10_000


@dataclass
class ColumnStatistics:
    """Per-column summary used to estimate selectivity."""

    name: str
    null_count: int = 0
    distinct_count: int = 0
    minimum: Any = None
    maximum: Any = None
    exact_distinct: bool = True

    def selectivity_for_equality(self, row_count: int) -> float:
        """Fraction of rows expected to survive ``column = <constant>``."""

        if row_count <= 0:
            return 1.0
        non_null = row_count - self.null_count
        if non_null <= 0:
            return 0.0
        if self.distinct_count <= 0:
            return 1.0 / max(row_count, 1)
        return min(1.0, (non_null / self.distinct_count) / row_count)

    def null_fraction(self, row_count: int) -> float:
        if row_count <= 0:
            return 0.0
        return self.null_count / row_count

    def describe(self) -> str:
        distinct = f"{self.distinct_count}" + ("" if self.exact_distinct else "+")
        return (
            f"{self.name}: distinct={distinct} nulls={self.null_count} "
            f"min={self.minimum!r} max={self.maximum!r}"
        )


@dataclass
class TableStatistics:
    """Row count plus per-column statistics for one table."""

    row_count: int = 0
    columns: dict[str, ColumnStatistics] = field(default_factory=dict)

    def column(self, name: str) -> Optional[ColumnStatistics]:
        return self.columns.get(name)

    def describe(self) -> str:
        lines = [f"rows: {self.row_count}"]
        lines.extend(
            "  " + self.columns[name].describe() for name in sorted(self.columns)
        )
        return "\n".join(lines)

    @classmethod
    def unknown(cls) -> "TableStatistics":
        return cls(row_count=0, columns={})


def compute_statistics(
    schema: Schema,
    rows: Sequence[Sequence[Any]],
    *,
    max_distinct: int = _MAX_TRACKED_DISTINCT,
) -> TableStatistics:
    """Compute statistics by walking ``rows`` once per column.

    Distinct counts stop being exact past ``max_distinct`` values; the flag on
    :class:`ColumnStatistics` records that so the cost model can widen its
    error bars instead of trusting a truncated number.
    """

    stats = TableStatistics(row_count=len(rows))
    for index, column in enumerate(schema):
        seen: set[Any] = set()
        overflow = False
        nulls = 0
        minimum: Any = None
        maximum: Any = None
        first = True
        for row in rows:
            value = row[index] if index < len(row) else None
            if value is None:
                nulls += 1
                continue
            if not overflow:
                try:
                    seen.add(value)
                except TypeError:  # pragma: no cover - unhashable values
                    overflow = True
                if len(seen) > max_distinct:
                    overflow = True
                    seen.clear()
            if first:
                minimum = maximum = value
                first = False
                continue
            if compare_values(value, minimum) < 0:
                minimum = value
            if compare_values(value, maximum) > 0:
                maximum = value
        stats.columns[column.name] = ColumnStatistics(
            name=column.name,
            null_count=nulls,
            distinct_count=max_distinct if overflow else len(seen),
            minimum=minimum,
            maximum=maximum,
            exact_distinct=not overflow,
        )
    return stats
