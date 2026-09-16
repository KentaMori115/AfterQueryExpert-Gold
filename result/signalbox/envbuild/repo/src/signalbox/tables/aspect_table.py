"""The aspect table: what every signal shows, given the one in front of it.

The control table has a column for this, but it is unreadable there, because the
sequence is a small table in its own right. Pulled out on its own it is the
document a tester works from when they stand in front of a signal and ask why it
is showing what it is showing.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ..signalling.aspects import AspectChart, build_chart
from ..signalling.interlocking import Interlocking
from ..signalling.signal import Aspect
from ..signalling.tpws import GridKind, grids_for
from ..topology.scheme import Scheme

ASPECT_COLUMNS = (
    "signal",
    "route",
    "ahead",
    "red",
    "yellow",
    "double yellow",
    "green",
    "heads",
    "protection",
)

_COLUMN_ASPECT = {
    "red": Aspect.RED,
    "yellow": Aspect.YELLOW,
    "double yellow": Aspect.DOUBLE_YELLOW,
    "green": Aspect.GREEN,
}


@dataclass(frozen=True)
class AspectRow:
    """One route's aspect sequence."""

    signal: str
    route: str
    ahead: str
    heads: int
    shown: dict[Aspect, Aspect]
    protection: tuple[str, ...] = ()
    clamped: bool = False

    def cell(self, column: str) -> str:
        if column == "signal":
            return self.signal
        if column == "route":
            return self.route
        if column == "ahead":
            return self.ahead
        if column == "heads":
            return str(self.heads)
        if column == "protection":
            return ", ".join(self.protection)
        aspect = _COLUMN_ASPECT.get(column)
        if aspect is None:
            raise KeyError(f"no such column: {column}")
        shown = self.shown.get(aspect)
        return str(shown) if shown is not None else "-"

    def __str__(self) -> str:
        pairs = " ".join(
            f"{ahead}>{shows}" for ahead, shows in sorted(self.shown.items(), key=_by_value)
        )
        return f"{self.route} behind {self.ahead}: {pairs}"


def _by_value(pair: tuple[Aspect, Aspect]) -> int:
    return pair[0].value


class AspectTable:
    def __init__(self, rows: list[AspectRow], chart: AspectChart) -> None:
        self.rows = rows
        self.chart = chart

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[AspectRow]:
        return iter(self.rows)

    def for_signal(self, name: str) -> list[AspectRow]:
        return [row for row in self.rows if row.signal == name]

    def clamped(self) -> list[AspectRow]:
        return [row for row in self.rows if row.clamped]


def build_aspect_table(scheme: Scheme, interlocking: Interlocking) -> AspectTable:
    chart = build_chart(scheme, interlocking)
    rows = []
    for rule in chart.rules:
        signal = scheme.signal(rule.entrance)
        grids = grids_for(scheme, signal)
        rows.append(
            AspectRow(
                signal=rule.entrance,
                route=rule.route,
                ahead=rule.ahead or "out of area",
                heads=signal.heads,
                shown=dict(rule.table),
                protection=tuple(grid.kind.value for grid in grids if grid.kind in GridKind),
                clamped=rule.clamped(),
            )
        )
    rows.sort(key=lambda row: (row.signal, row.route))
    return AspectTable(rows, chart)
