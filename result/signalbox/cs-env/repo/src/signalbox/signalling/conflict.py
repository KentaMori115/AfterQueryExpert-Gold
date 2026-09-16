"""Which routes may not be set at the same time, and why.

Two routes conflict when setting both would put a train somewhere the other one
is relying on. That happens for four reasons worth telling apart, because a
control table has to print the reason and not just the fact:

* they start at the same signal, so only one of them can be the route that
  signal is cleared for;
* they run over the same track;
* they want the same points lying different ways, either to run over or to hold
  as flank protection;
* one runs over track the other is holding as its overlap.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from itertools import combinations

from ..topology.graph import Lie
from .interlocking import Interlocking, RoutePlan
from .subroute import opposed, shared


class Reason(Enum):
    SAME_SIGNAL = "same signal"
    TRACK = "track"
    POINTS = "points"
    FLANK = "flank"
    OVERLAP = "overlap"

    @property
    def is_absolute(self) -> bool:
        """Whether the conflict can never be worked round by swinging anything."""
        return self in (Reason.SAME_SIGNAL, Reason.TRACK, Reason.POINTS)


@dataclass(frozen=True)
class Conflict:
    """One reason a pair of routes cannot both be set."""

    first: str
    second: str
    reason: Reason
    detail: str = ""

    @property
    def pair(self) -> tuple[str, str]:
        return tuple(sorted((self.first, self.second)))  # type: ignore[return-value]

    def __str__(self) -> str:
        tail = f" ({self.detail})" if self.detail else ""
        return f"{self.first} against {self.second}: {self.reason.value}{tail}"


def _opposed_points(a: dict[str, Lie], b: dict[str, Lie]) -> list[str]:
    return sorted(node for node, lie in a.items() if b.get(node) not in (None, lie))


def conflicts_between(first: RoutePlan, second: RoutePlan) -> list[Conflict]:
    """Every reason these two routes conflict, or an empty list if they do not."""
    if first.name == second.name:
        return []
    found: list[Conflict] = []

    if first.entrance == second.entrance:
        found.append(Conflict(first.name, second.name, Reason.SAME_SIGNAL, first.entrance))

    over_track = shared(first.track, second.track)
    if over_track:
        found.append(Conflict(first.name, second.name, Reason.TRACK, ", ".join(over_track)))

    points_opposed = _opposed_points(dict(first.points()), dict(second.points()))
    if points_opposed:
        found.append(
            Conflict(first.name, second.name, Reason.POINTS, ", ".join(points_opposed))
        )

    flank_opposed = _opposed_points(
        {**dict(first.points()), **dict(first.flank_points())},
        {**dict(second.points()), **dict(second.flank_points())},
    )
    extra = [node for node in flank_opposed if node not in points_opposed]
    if extra:
        found.append(Conflict(first.name, second.name, Reason.FLANK, ", ".join(extra)))

    # An overlap only gets in the way of a move going the other way over the
    # same track. A route running on past the signal in the same direction takes
    # the overlap over from behind it, which is what following moves are.
    overlap_clash = sorted(
        set(opposed(first.overlap_track, second.track))
        | set(opposed(second.overlap_track, first.track))
        | set(opposed(first.overlap_track, second.overlap_track))
    )
    if overlap_clash and not over_track:
        found.append(
            Conflict(first.name, second.name, Reason.OVERLAP, ", ".join(overlap_clash))
        )

    return found


class ConflictMatrix:
    """The whole table of which routes lock which others out."""

    def __init__(self, conflicts: list[Conflict]) -> None:
        self.conflicts = conflicts
        self._by_route: dict[str, set[str]] = {}
        for conflict in conflicts:
            self._by_route.setdefault(conflict.first, set()).add(conflict.second)
            self._by_route.setdefault(conflict.second, set()).add(conflict.first)

    def __len__(self) -> int:
        return len(self.conflicts)

    def against(self, route: str) -> list[str]:
        return sorted(self._by_route.get(route, set()))

    def clashes(self, first: str, second: str) -> bool:
        return second in self._by_route.get(first, set())

    def reasons(self, first: str, second: str) -> list[Conflict]:
        wanted = {first, second}
        return [c for c in self.conflicts if {c.first, c.second} == wanted]

    def free_with(self, route: str, everything: list[str]) -> list[str]:
        """Routes that may be set at the same time as this one."""
        blocked = self._by_route.get(route, set())
        return sorted(name for name in everything if name != route and name not in blocked)


def build_matrix(interlocking: Interlocking) -> ConflictMatrix:
    """Compare every pair of routes once."""
    found: list[Conflict] = []
    for first, second in combinations(interlocking.sorted_plans(), 2):
        found.extend(conflicts_between(first, second))
    return ConflictMatrix(found)
