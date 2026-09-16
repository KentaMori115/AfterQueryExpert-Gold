"""Column-oriented views over row data.

The executor is row-at-a-time, but several utilities -- statistics, CSV
export, and the ``describe`` command -- want to look at one column across many
rows.  :class:`ColumnView` provides that without copying the underlying rows.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional, Sequence

from ..types.datatypes import DataType
from ..types.schema import Field, Schema

__all__ = ["ColumnView", "columns_of_rows", "to_column_dict"]


class ColumnView:
    """A read-only view of one column of a row collection."""

    __slots__ = ("_rows", "_ordinal", "_field")

    def __init__(self, rows: Sequence[Sequence[Any]], ordinal: int, field: Field) -> None:
        self._rows = rows
        self._ordinal = ordinal
        self._field = field

    @property
    def name(self) -> str:
        return self._field.name

    @property
    def dtype(self) -> DataType:
        return self._field.dtype

    def __len__(self) -> int:
        return len(self._rows)

    def __iter__(self) -> Iterator[Any]:
        ordinal = self._ordinal
        for row in self._rows:
            yield row[ordinal]

    def __getitem__(self, index: int) -> Any:
        return self._rows[index][self._ordinal]

    def to_list(self) -> list[Any]:
        return list(self)

    def null_count(self) -> int:
        return sum(1 for value in self if value is None)

    def distinct(self) -> list[Any]:
        """Distinct non-null values in first-appearance order."""

        seen: set[Any] = set()
        out: list[Any] = []
        for value in self:
            if value is None or value in seen:
                continue
            seen.add(value)
            out.append(value)
        return out

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"ColumnView({self.name!r}, rows={len(self)})"


def columns_of_rows(
    schema: Schema, rows: Sequence[Sequence[Any]]
) -> list[ColumnView]:
    """Build one :class:`ColumnView` per field of ``schema``."""

    return [
        ColumnView(rows, ordinal, field) for ordinal, field in enumerate(schema)
    ]


def to_column_dict(
    schema: Schema,
    rows: Sequence[Sequence[Any]],
    *,
    qualified: bool = False,
) -> dict[str, list[Any]]:
    """Convert rows to a ``{column_name: values}`` mapping."""

    out: dict[str, list[Any]] = {}
    for ordinal, field in enumerate(schema):
        key = field.qualified_name if qualified else field.name
        out[key] = [row[ordinal] for row in rows]
    return out


def column_by_name(
    schema: Schema, rows: Sequence[Sequence[Any]], name: str
) -> Optional[ColumnView]:
    """Look up one column view by name, returning ``None`` when absent."""

    ordinal = schema.try_index_of(name)
    if ordinal is None:
        return None
    return ColumnView(rows, ordinal, schema[ordinal])
