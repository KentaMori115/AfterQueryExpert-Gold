"""The control table: one row per route, one column per thing that must be true.

This is the document the whole toolkit exists to produce. Each row says what the
signaller gets when the route is set, and every entry in it can be traced back
to something in the scheme plan.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from ..signalling.approach import ApproachLock, approach_lock_for
from ..signalling.aspects import AspectChart, build_chart
from ..signalling.conflict import ConflictMatrix, build_matrix
from ..signalling.crossing import requirements_for
from ..signalling.interlocking import Interlocking, RoutePlan
from ..signalling.locking import LockingEntry, LockingTable, build_locking
from ..signalling.signal import Aspect
from ..topology.graph import Lie
from ..topology.scheme import Scheme

#: The columns of the table, in the order they are printed.
COLUMNS = (
    "route",
    "from",
    "to",
    "class",
    "points normal",
    "points reverse",
    "overlap",
    "flank",
    "held",
    "track clear",
    "locks out",
    "approach",
    "crossings",
    "aspect",
)


@dataclass(frozen=True)
class ControlRow:
    """One route's line in the control table."""

    route: str
    entrance: str
    exit: str
    klass: str
    points_normal: tuple[str, ...] = ()
    points_reverse: tuple[str, ...] = ()
    overlap: tuple[str, ...] = ()
    flank_points: tuple[str, ...] = ()
    signals_held: tuple[str, ...] = ()
    track_clear: tuple[str, ...] = ()
    locks_out: tuple[str, ...] = ()
    approach: str = ""
    crossings: tuple[str, ...] = ()
    aspect: str = ""
    notes: tuple[str, ...] = field(default_factory=tuple)

    def cell(self, column: str) -> str:
        """The printed contents of one column."""
        value = {
            "route": self.route,
            "from": self.entrance,
            "to": self.exit,
            "class": self.klass,
            "points normal": self.points_normal,
            "points reverse": self.points_reverse,
            "overlap": self.overlap,
            "flank": self.flank_points,
            "held": self.signals_held,
            "track clear": self.track_clear,
            "locks out": self.locks_out,
            "approach": self.approach,
            "crossings": self.crossings,
            "aspect": self.aspect,
        }[column]
        if isinstance(value, tuple):
            return ", ".join(value)
        return str(value)

    def as_dict(self) -> dict[str, str]:
        return {column: self.cell(column) for column in COLUMNS}

    def __str__(self) -> str:
        return f"{self.route} {self.entrance}-{self.exit}"


class ControlTable:
    """Every row, with the working that produced them kept alongside."""

    def __init__(
        self,
        rows: list[ControlRow],
        *,
        scheme: Scheme,
        matrix: ConflictMatrix,
        locking: LockingTable,
        chart: AspectChart,
    ) -> None:
        self.rows = rows
        self.scheme = scheme
        self.matrix = matrix
        self.locking = locking
        self.chart = chart
        self._by_route = {row.route: row for row in rows}

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[ControlRow]:
        return iter(self.rows)

    def row(self, route: str) -> ControlRow:
        return self._by_route[route]

    def routes(self) -> list[str]:
        return [row.route for row in self.rows]

    def for_signal(self, signal: str) -> list[ControlRow]:
        return [row for row in self.rows if row.entrance == signal]

    def column(self, name: str) -> list[str]:
        return [row.cell(name) for row in self.rows]


def _split_points(points: dict[str, Lie]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    normal = tuple(sorted(node for node, lie in points.items() if lie is Lie.NORMAL))
    reverse = tuple(sorted(node for node, lie in points.items() if lie is Lie.REVERSE))
    return normal, reverse


def _aspect_cell(chart: AspectChart, plan: RoutePlan) -> str:
    rule = chart.rule(plan.name)
    if rule is None:
        return "shunt"
    parts = [f"{ahead}>{shown}" for ahead, shown in sorted(rule.table.items(), key=_by_value)]
    return " ".join(parts)


def _by_value(pair: tuple[Aspect, Aspect]) -> int:
    return pair[0].value


def _row_for(
    scheme: Scheme,
    plan: RoutePlan,
    entry: LockingEntry,
    approach: ApproachLock,
    chart: AspectChart,
) -> ControlRow:
    route_points = dict(plan.points())
    normal, reverse = _split_points(route_points)
    overlap = plan.overlap
    return ControlRow(
        route=plan.name,
        entrance=plan.entrance,
        exit=str(plan.route.exit),
        klass=plan.klass.value,
        points_normal=normal,
        points_reverse=reverse,
        overlap=overlap.sections if overlap else (),
        flank_points=tuple(
            f"{node} {lie.value}" for node, lie in sorted(plan.flank_points().items())
        ),
        signals_held=plan.signals_held(),
        track_clear=tuple(sub.name for sub in entry.held_track()),
        locks_out=entry.locks_out,
        approach=approach.describe(),
        crossings=requirements_for(scheme, plan),
        aspect=_aspect_cell(chart, plan),
    )


def build_control_table(scheme: Scheme, interlocking: Interlocking) -> ControlTable:
    """Turn a finished interlocking into the table it is signed off on."""
    matrix = build_matrix(interlocking)
    locking = build_locking(interlocking, matrix)
    chart = build_chart(scheme, interlocking)

    rows = [
        _row_for(
            scheme,
            plan,
            locking.entry(plan.name),
            approach_lock_for(scheme, plan),
            chart,
        )
        for plan in interlocking.sorted_plans()
    ]
    return ControlTable(rows, scheme=scheme, matrix=matrix, locking=locking, chart=chart)
