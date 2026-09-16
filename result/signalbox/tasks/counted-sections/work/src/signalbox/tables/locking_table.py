"""The locking table: what each route holds and what it holds out.

The control table says what has to be true before a route can be set. This says
what happens once it is: the sub routes held, the order they release in, and the
list of routes that cannot be set until they have. It is the document that gets
compared line by line against the interlocking data when a scheme is tested.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ..signalling.conflict import ConflictMatrix, build_matrix
from ..signalling.interlocking import Interlocking
from ..signalling.locking import LockingTable, build_locking

LOCKING_COLUMNS = (
    "route",
    "holds",
    "overlap",
    "release",
    "releases",
    "zones",
    "locks out",
    "held by",
)


@dataclass(frozen=True)
class LockingRow:
    """One route's locking, read as a row."""

    route: str
    holds: tuple[str, ...]
    overlap: tuple[str, ...]
    release: str
    releases: tuple[str, ...]
    locks_out: tuple[str, ...]
    held_by: tuple[str, ...]
    zones: tuple[str, ...] = ()

    @property
    def is_sectional(self) -> bool:
        return self.release == "sectional"

    def cell(self, column: str) -> str:
        value = {
            "route": self.route,
            "holds": self.holds,
            "overlap": self.overlap,
            "release": self.release,
            "releases": self.releases,
            "zones": self.zones,
            "locks out": self.locks_out,
            "held by": self.held_by,
        }[column]
        return ", ".join(value) if isinstance(value, tuple) else str(value)

    def __str__(self) -> str:
        return f"{self.route}: {', '.join(self.holds) or 'nothing'}"


class LockingReport:
    def __init__(
        self, rows: list[LockingRow], table: LockingTable, matrix: ConflictMatrix
    ) -> None:
        self.rows = rows
        self.table = table
        self.matrix = matrix
        self._by_route = {row.route: row for row in rows}

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[LockingRow]:
        return iter(self.rows)

    def row(self, route: str) -> LockingRow:
        return self._by_route[route]

    def sectional(self) -> list[LockingRow]:
        return [row for row in self.rows if row.is_sectional]

    def holders_of(self, subroute: str) -> list[str]:
        return sorted(row.route for row in self.rows if subroute in row.holds)


def build_locking_report(interlocking: Interlocking) -> LockingReport:
    matrix = build_matrix(interlocking)
    table = build_locking(interlocking, matrix)

    holders: dict[str, list[str]] = {}
    for entry in table:
        for sub in entry.held_track():
            holders.setdefault(sub.name, []).append(entry.route)

    rows = []
    for entry in table.sorted_entries():
        plan = interlocking.plan(entry.route)
        held_by = sorted(
            {
                other
                for sub in entry.held_track()
                for other in holders.get(sub.reverse.name, ())
                if other != entry.route
            }
        )
        rows.append(
            LockingRow(
                route=entry.route,
                holds=tuple(sub.name for sub in plan.track),
                overlap=tuple(sub.name for sub in plan.overlap_track),
                release=entry.release.value,
                releases=tuple(sub.name for sub in entry.releases_in_order()),
                zones=entry.zones_held(),
                locks_out=entry.locks_out,
                held_by=tuple(held_by),
            )
        )
    return LockingReport(rows, table, matrix)
