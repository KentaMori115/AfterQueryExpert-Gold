"""Comparing two control tables, which is how a change gets reviewed.

Nobody reads a four hundred row control table twice. What gets reviewed is the
difference between the table the scheme had and the table the scheme has after
somebody moved a signal, and that difference has to be exact: a route that has
gained a set of flank points is a change worth arguing about, and a route whose
columns happen to have been reordered is not.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import Enum

from .control_table import COLUMNS, ControlRow, ControlTable


class Change(Enum):
    ADDED = "added"
    REMOVED = "removed"
    CHANGED = "changed"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class CellChange:
    """One column of one route that reads differently now."""

    column: str
    before: str
    after: str

    def __str__(self) -> str:
        return f"{self.column}: {self.before or '-'} -> {self.after or '-'}"


@dataclass(frozen=True)
class RowChange:
    """What happened to one route between the two tables."""

    route: str
    change: Change
    cells: tuple[CellChange, ...] = field(default_factory=tuple)

    @property
    def columns(self) -> tuple[str, ...]:
        return tuple(cell.column for cell in self.cells)

    def touches(self, column: str) -> bool:
        return column in self.columns

    def __str__(self) -> str:
        if self.change is not Change.CHANGED:
            return f"{self.change.value} {self.route}"
        detail = "; ".join(str(cell) for cell in self.cells)
        return f"changed {self.route}: {detail}"


@dataclass
class TableDiff:
    """Every difference between two control tables."""

    changes: list[RowChange] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.changes)

    def __iter__(self) -> Iterator[RowChange]:
        return iter(self.changes)

    @property
    def empty(self) -> bool:
        return not self.changes

    def of_kind(self, change: Change) -> list[RowChange]:
        return [row for row in self.changes if row.change is change]

    def added(self) -> list[str]:
        return [row.route for row in self.of_kind(Change.ADDED)]

    def removed(self) -> list[str]:
        return [row.route for row in self.of_kind(Change.REMOVED)]

    def touching(self, column: str) -> list[RowChange]:
        return [row for row in self.changes if row.touches(column)]

    def summary(self) -> str:
        if self.empty:
            return "no change"
        counts = {change: len(self.of_kind(change)) for change in Change}
        parts = [f"{count} {change.value}" for change, count in counts.items() if count]
        return ", ".join(parts)

    def report(self) -> str:
        return "\n".join(str(change) for change in self.changes) or "no change\n"


def _rows(table: ControlTable | list[ControlRow]) -> dict[str, ControlRow]:
    return {row.route: row for row in table}


def diff_tables(
    before: ControlTable | list[ControlRow],
    after: ControlTable | list[ControlRow],
    *,
    columns: tuple[str, ...] = COLUMNS,
) -> TableDiff:
    """Compare two tables route by route, column by column."""
    old = _rows(before)
    new = _rows(after)
    changes: list[RowChange] = []

    for route in sorted(set(old) | set(new)):
        if route not in new:
            changes.append(RowChange(route, Change.REMOVED))
            continue
        if route not in old:
            changes.append(RowChange(route, Change.ADDED))
            continue
        cells = tuple(
            CellChange(column, old[route].cell(column), new[route].cell(column))
            for column in columns
            if old[route].cell(column) != new[route].cell(column)
        )
        if cells:
            changes.append(RowChange(route, Change.CHANGED, cells))

    return TableDiff(changes)
