"""What a set route holds, and the order in which it lets go again.

While a route is set the interlocking holds three things: the points it runs
over, the track it runs over, and every route that would conflict with it. The
track is held as sub routes, one per section, each with the direction the train
runs through it, because that is what lets a long route release behind a train
section by section instead of all at once when it finally arrives.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from enum import Enum

from ..topology.graph import Lie
from ..topology.scheme import Scheme
from .conflict import ConflictMatrix
from .interlocking import Interlocking, RoutePlan
from .subroute import Subroute


class Release(Enum):
    """How a route gives up the track it is holding."""

    SECTIONAL = "sectional"
    COMPLETE = "complete"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class LockingEntry:
    """The locking for one route."""

    route: str
    points: Mapping[str, Lie] = field(default_factory=dict)
    subroutes: tuple[Subroute, ...] = ()
    overlap_subroutes: tuple[Subroute, ...] = ()
    locks_out: tuple[str, ...] = ()
    release: Release = Release.SECTIONAL

    @property
    def is_sectional(self) -> bool:
        return self.release is Release.SECTIONAL

    def held_track(self) -> tuple[Subroute, ...]:
        return self.subroutes + self.overlap_subroutes

    def releases_in_order(self) -> list[Subroute]:
        """Sub routes in the order a train passing over them frees them."""
        if self.release is Release.COMPLETE:
            return list(self.held_track())
        return list(self.subroutes) + list(self.overlap_subroutes)

    def locks(self, node: str) -> Lie | None:
        return self.points.get(node)

    def __str__(self) -> str:
        track = " ".join(s.name for s in self.subroutes) or "none"
        return f"{self.route}: {track}"


def locking_for(
    scheme: Scheme,
    plan: RoutePlan,
    matrix: ConflictMatrix,
    *,
    sectional_release: bool = True,
) -> LockingEntry:
    """Work out the locking for one route."""
    del scheme
    subroutes = plan.track
    overlap_subroutes = plan.overlap_track

    points = dict(plan.points())
    points.update(plan.overlap_points())
    points.update(plan.flank_points())

    release = (
        Release.SECTIONAL if sectional_release and len(subroutes) > 1 else Release.COMPLETE
    )
    return LockingEntry(
        route=plan.name,
        points=points,
        subroutes=subroutes,
        overlap_subroutes=overlap_subroutes,
        locks_out=tuple(matrix.against(plan.name)),
        release=release,
    )


class LockingTable:
    """Locking for every route in a scheme."""

    def __init__(self, entries: list[LockingEntry]) -> None:
        self.entries = {entry.route: entry for entry in entries}

    def __len__(self) -> int:
        return len(self.entries)

    def __iter__(self) -> Iterator[LockingEntry]:
        return iter(self.sorted_entries())

    def sorted_entries(self) -> list[LockingEntry]:
        return [self.entries[name] for name in sorted(self.entries)]

    def entry(self, route: str) -> LockingEntry:
        return self.entries[route]

    def holders_of(self, subroute: Subroute) -> list[str]:
        return sorted(
            name for name, entry in self.entries.items() if subroute in entry.held_track()
        )

    def opposing_holders(self, subroute: Subroute) -> list[str]:
        return self.holders_of(subroute.reverse)


def build_locking(
    interlocking: Interlocking,
    matrix: ConflictMatrix,
    *,
    sectional_release: bool = True,
) -> LockingTable:
    return LockingTable(
        [
            locking_for(interlocking.scheme, plan, matrix, sectional_release=sectional_release)
            for plan in interlocking.sorted_plans()
        ]
    )
