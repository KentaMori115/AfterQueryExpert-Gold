"""The points table: one row per set of points, one column per thing it owes.

The control table is read route by route. When something is wrong with a set of
points it is quicker to read the same information the other way up, which is
what this is for: every route that calls these points, which way, and whether
the move over them is facing or trailing.

A facing move is the one that matters. If the blades are not where the
interlocking thinks they are, a trailing move gets a broken switch and a facing
move gets a derailment, which is why facing points carry a lock.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ..signalling.flank import nodes_on
from ..signalling.interlocking import Interlocking, RoutePlan
from ..signalling.points import DEFAULT_THROW, Motor, PointsMachine
from ..topology.graph import Lie
from ..topology.scheme import Scheme

POINT_COLUMNS = (
    "points",
    "normal for",
    "reverse for",
    "facing for",
    "flank for",
    "overlap for",
    "locked",
    "machine",
    "throw",
)


@dataclass(frozen=True)
class PointsRow:
    """Everything that has an opinion about one set of points."""

    points: str
    normal_for: tuple[str, ...] = ()
    reverse_for: tuple[str, ...] = ()
    facing_for: tuple[str, ...] = ()
    flank_for: tuple[str, ...] = ()
    overlap_for: tuple[str, ...] = ()
    machine: PointsMachine | None = None

    @property
    def is_facing(self) -> bool:
        return bool(self.facing_for)

    @property
    def needs_a_lock(self) -> bool:
        """Facing points under a passenger move have to be locked as well as detected."""
        return self.is_facing

    @property
    def lock_is_missing(self) -> bool:
        return self.needs_a_lock and self.machine is not None and not self.machine.locked

    @property
    def throw(self) -> float:
        return self.machine.throw if self.machine else DEFAULT_THROW

    @property
    def motor(self) -> Motor:
        return self.machine.motor if self.machine else Motor.ELECTRIC

    @property
    def routes(self) -> tuple[str, ...]:
        return tuple(sorted(set(self.normal_for) | set(self.reverse_for)))

    @property
    def unused(self) -> bool:
        return not self.routes and not self.flank_for and not self.overlap_for

    def cell(self, column: str) -> str:
        value = {
            "points": self.points,
            "normal for": self.normal_for,
            "reverse for": self.reverse_for,
            "facing for": self.facing_for,
            "flank for": self.flank_for,
            "overlap for": self.overlap_for,
            "locked": "yes" if self.needs_a_lock else "no",
            "machine": self.motor.value,
            "throw": f"{self.throw:.1f}s",
        }[column]
        return ", ".join(value) if isinstance(value, tuple) else str(value)

    def __str__(self) -> str:
        return f"{self.points}: {len(self.routes)} routes"


class PointsTable:
    def __init__(self, rows: list[PointsRow]) -> None:
        self.rows = rows
        self._by_name = {row.points: row for row in rows}

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[PointsRow]:
        return iter(self.rows)

    def row(self, points: str) -> PointsRow:
        return self._by_name[points]

    def facing(self) -> list[PointsRow]:
        return [row for row in self.rows if row.is_facing]

    def unused(self) -> list[PointsRow]:
        return [row for row in self.rows if row.unused]

    def slow(self, over: float = 12.0) -> list[PointsRow]:
        return [row for row in self.rows if row.throw > over]

    def without_locks(self) -> list[PointsRow]:
        return [row for row in self.rows if row.lock_is_missing]


def _facing_moves(scheme: Scheme, plan: RoutePlan) -> set[str]:
    """Points this route runs over toe first."""
    facing: set[str] = set()
    for node, in_port, _out in nodes_on(scheme.graph, plan.route.covered_edges):
        if in_port == "toe" and scheme.graph.node(node).is_points:
            facing.add(node)
    return facing


def build_points_table(scheme: Scheme, interlocking: Interlocking) -> PointsTable:
    """Invert the interlocking so that it reads points by points."""
    normal: dict[str, list[str]] = {}
    reverse: dict[str, list[str]] = {}
    facing: dict[str, list[str]] = {}
    flank: dict[str, list[str]] = {}
    overlap: dict[str, list[str]] = {}

    for plan in interlocking.sorted_plans():
        for node, lie in plan.points().items():
            (normal if lie is Lie.NORMAL else reverse).setdefault(node, []).append(plan.name)
        for node in sorted(_facing_moves(scheme, plan)):
            facing.setdefault(node, []).append(plan.name)
        for node in plan.flank_points():
            flank.setdefault(node, []).append(plan.name)
        for node in plan.overlap_points():
            overlap.setdefault(node, []).append(plan.name)

    rows = [
        PointsRow(
            points=node,
            normal_for=tuple(normal.get(node, ())),
            reverse_for=tuple(reverse.get(node, ())),
            facing_for=tuple(facing.get(node, ())),
            flank_for=tuple(flank.get(node, ())),
            overlap_for=tuple(overlap.get(node, ())),
            machine=scheme.machines.get(node),
        )
        for node in scheme.graph.movable()
    ]
    return PointsTable(rows)
