"""What a set route holds, and the order in which it lets go again.

While a route is set the interlocking holds three things: the points it runs
over, the track it runs over, and every route that would conflict with it. The
track is held as sub routes, one per section, each with the direction the train
runs through it, because that is what lets a long route release behind a train
section by section instead of all at once when it finally arrives.

Releasing behind a train assumes each section can say on its own that the train
has gone. A track circuit can. An axle counter cannot, because what it knows is
a count, and a count is only worth anything over a whole reset zone. So sub
routes whose sections share a zone come back together, at the moment the last of
them is clear, and a route whose track is all inside one zone has nothing to
release piecemeal at all.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from enum import Enum

from ..topology.counting import CountingPlan, build_counting
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
    zones: Mapping[str, str] = field(default_factory=dict)

    @property
    def is_sectional(self) -> bool:
        return self.release is Release.SECTIONAL

    def held_track(self) -> tuple[Subroute, ...]:
        return self.subroutes + self.overlap_subroutes

    def zone_of(self, subroute: Subroute) -> str | None:
        """The reset zone a sub route's section is in, if it is counted."""
        return self.zones.get(subroute.section)

    def release_groups(self) -> list[tuple[Subroute, ...]]:
        """Held track in the order it frees, sub routes that share a zone together.

        A sub route on a track circuit is its own group. Sub routes whose
        sections share a reset zone are one group, and the group sits where the
        last of them does, because that is when the count comes right.
        """
        held = list(self.held_track())
        keys = [self.zone_of(sub) or f"={sub.name}" for sub in held]
        order: list[str] = []
        for index, key in enumerate(keys):
            if key not in keys[index + 1 :]:
                order.append(key)
        return [
            tuple(sub for sub, key in zip(held, keys, strict=True) if key == wanted)
            for wanted in order
        ]

    def releases_in_order(self) -> list[Subroute]:
        """Sub routes in the order a train passing over them frees them."""
        return [sub for group in self.release_groups() for sub in group]

    def zones_held(self) -> tuple[str, ...]:
        """Reset zones this route's track sits in, in name order."""
        found = {self.zones[sub.section] for sub in self.held_track()
                 if sub.section in self.zones}
        return tuple(sorted(found))

    def locks(self, node: str) -> Lie | None:
        return self.points.get(node)

    def __str__(self) -> str:
        track = " ".join(s.name for s in self.subroutes) or "none"
        return f"{self.route}: {track}"


def _zone_map(scheme: Scheme, counting: CountingPlan | None) -> dict[str, str]:
    """Section name to reset zone name, for the counted sections only."""
    plan = counting or build_counting(scheme.graph, scheme.sections)
    return {
        section: zone.name for zone in plan.zones for section in zone.sections
    }


def _groups_in(subroutes: tuple[Subroute, ...], zones: Mapping[str, str]) -> int:
    """How many separately releasable pieces a run of sub routes comes to.

    Counted over everything the route holds, its overlap included. The overlap
    is held for the same reason the route is, and a route that cannot prove the
    overlap clear on its own has nothing to give up early either.
    """
    keys = [zones.get(sub.section) or f"={sub.name}" for sub in subroutes]
    return len(set(keys))


def locking_for(
    scheme: Scheme,
    plan: RoutePlan,
    matrix: ConflictMatrix,
    *,
    sectional_release: bool = True,
    counting: CountingPlan | None = None,
) -> LockingEntry:
    """Work out the locking for one route."""
    subroutes = plan.track
    overlap_subroutes = plan.overlap_track
    zones = _zone_map(scheme, counting)

    points = dict(plan.points())
    points.update(plan.overlap_points())
    points.update(plan.flank_points())

    held = subroutes + overlap_subroutes
    piecemeal = sectional_release and _groups_in(held, zones) > 1
    release = Release.SECTIONAL if piecemeal else Release.COMPLETE
    return LockingEntry(
        route=plan.name,
        points=points,
        subroutes=subroutes,
        overlap_subroutes=overlap_subroutes,
        locks_out=tuple(matrix.against(plan.name)),
        release=release,
        zones={
            section: zone
            for section, zone in zones.items()
            if any(sub.section == section for sub in subroutes + overlap_subroutes)
        },
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
    scheme = interlocking.scheme
    counting = build_counting(scheme.graph, scheme.sections)
    return LockingTable(
        [
            locking_for(
                scheme,
                plan,
                matrix,
                sectional_release=sectional_release,
                counting=counting,
            )
            for plan in interlocking.sorted_plans()
        ]
    )
