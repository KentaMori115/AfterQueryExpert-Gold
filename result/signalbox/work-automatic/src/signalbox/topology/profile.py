"""The gradient profile along a run of track.

Braking is worked out against the worst gradient on a route, but the worst
gradient is not the whole story: a route that falls for eight hundred metres and
then rises is a different thing from one that falls the whole way, and a summit
in the middle of a section is where a train will stall and stand.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from ..units import Distance, Gradient
from .graph import Sense, TrackGraph

#: A gradient steeper than this is worth pointing at.
STEEP = 100.0


@dataclass(frozen=True)
class Stretch:
    """One edge of a profile, with the height it gains or loses."""

    edge: str
    length: Distance
    gradient: Gradient
    rise: float

    @property
    def falling(self) -> bool:
        return self.rise < 0

    @property
    def level(self) -> bool:
        return abs(self.rise) < 1e-9

    @property
    def steep(self) -> bool:
        one_in = abs(self.gradient.one_in)
        return one_in != float("inf") and one_in <= STEEP

    def __str__(self) -> str:
        return f"{self.edge}: {self.length.metres:.0f}m at {self.gradient}"


@dataclass
class Profile:
    """The whole run, stretch by stretch."""

    stretches: list[Stretch] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.stretches)

    def __iter__(self) -> Iterator[Stretch]:
        return iter(self.stretches)

    @property
    def length(self) -> Distance:
        return Distance(sum(s.length.metres for s in self.stretches))

    @property
    def rise(self) -> float:
        """Net height gained over the whole run, in metres."""
        return sum(s.rise for s in self.stretches)

    def climbed(self) -> float:
        return sum(s.rise for s in self.stretches if s.rise > 0)

    def dropped(self) -> float:
        return -sum(s.rise for s in self.stretches if s.rise < 0)

    def worst_falling(self) -> Stretch | None:
        falling = [s for s in self.stretches if s.falling]
        if not falling:
            return None
        return min(falling, key=lambda s: s.gradient.per_mille)

    def steepest(self) -> Stretch | None:
        if not self.stretches:
            return None
        return max(self.stretches, key=lambda s: abs(s.gradient.per_mille))

    def summits(self) -> list[str]:
        """Edges where the run stops rising and starts falling."""
        found = []
        for before, after in zip(self.stretches, self.stretches[1:], strict=False):
            if before.rise > 0 and after.rise < 0:
                found.append(before.edge)
        return found

    def steep_stretches(self) -> list[Stretch]:
        return [s for s in self.stretches if s.steep]

    def describe(self) -> str:
        if not self.stretches:
            return "no track to profile"
        return (
            f"{self.length.metres:.0f}m, "
            f"up {self.climbed():.1f}m and down {self.dropped():.1f}m, "
            f"net {self.rise:+.1f}m"
        )


def profile(graph: TrackGraph, steps: tuple[tuple[str, Sense], ...]) -> Profile:
    """The profile of a run of edges, in the order they are travelled.

    A gradient is written for the down direction, so a run in the up sense of an
    edge climbs where the edge falls.
    """
    stretches = []
    for edge_name, sense in steps:
        edge = graph.edge(edge_name)
        per_mille = edge.gradient.per_mille
        if sense is Sense.REVERSE:
            per_mille = -per_mille
        rise = edge.length.metres * per_mille / 1000.0
        stretches.append(Stretch(edge_name, edge.length, edge.gradient, rise))
    return Profile(stretches)
