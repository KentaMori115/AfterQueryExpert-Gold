"""How close together trains can run, which is what the signalling is for.

Capacity comes out of the block lengths and the aspect sequence. A four aspect
scheme with short blocks carries more trains than a three aspect scheme with
long ones, and the difference is arithmetic, not opinion. What this produces is
a planning figure per block, and the worst block, because that is the one that
decides the headway of the whole line.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..topology.scheme import Scheme
from ..units import Distance, Speed
from .braking import headway_seconds
from .interlocking import Interlocking
from .signal import SignalType

#: The train the headway is quoted for, unless something else is asked for.
PLANNING_TRAIN = Distance(200.0)


@dataclass(frozen=True)
class Leg:
    """One block, with the headway it allows."""

    route: str
    entrance: str
    exit: str
    length: Distance
    speed: Speed
    heads: int
    seconds: float

    @property
    def minutes(self) -> float:
        return self.seconds / 60.0

    @property
    def trains_per_hour(self) -> float:
        return 3600.0 / self.seconds if self.seconds > 0 else 0.0

    def __str__(self) -> str:
        return (
            f"{self.entrance} to {self.exit}: {self.length.metres:.0f}m at {self.speed}, "
            f"{self.seconds:.0f}s"
        )


def legs(
    scheme: Scheme,
    interlocking: Interlocking,
    *,
    train: Distance = PLANNING_TRAIN,
) -> list[Leg]:
    """A headway figure for every main route between two signals."""
    found: list[Leg] = []
    for plan in interlocking.sorted_plans():
        if not plan.klass.clears_signal or not plan.route.exit.is_signal:
            continue
        entrance = scheme.signal(plan.entrance)
        if entrance.type is not SignalType.MAIN:
            continue
        speed = _slowest(scheme, plan.route.edges)
        if speed is None or speed.mps <= 0:
            continue
        seconds = headway_seconds(speed, plan.route.length, train, heads=entrance.heads)
        found.append(
            Leg(
                route=plan.name,
                entrance=plan.entrance,
                exit=plan.exit,
                length=plan.route.length,
                speed=speed,
                heads=entrance.heads,
                seconds=seconds,
            )
        )
    return found


def _slowest(scheme: Scheme, edges: tuple[str, ...]) -> Speed | None:
    speeds = [scheme.graph.edge(name).speed for name in edges]
    known = [speed for speed in speeds if speed is not None]
    return min(known, key=lambda s: s.mps) if known else None


def worst(found: list[Leg]) -> Leg | None:
    """The block that holds the line up the most."""
    if not found:
        return None
    return max(found, key=lambda leg: leg.seconds)


def best(found: list[Leg]) -> Leg | None:
    if not found:
        return None
    return min(found, key=lambda leg: leg.seconds)


def line_headway(found: list[Leg]) -> float:
    """The headway of the line, which is the headway of its worst block."""
    slowest = worst(found)
    return slowest.seconds if slowest is not None else 0.0


def trains_per_hour(found: list[Leg]) -> float:
    seconds = line_headway(found)
    return 3600.0 / seconds if seconds > 0 else 0.0


def summarise(found: list[Leg]) -> str:
    if not found:
        return "no blocks to measure"
    slowest = worst(found)
    assert slowest is not None
    return (
        f"{len(found)} blocks, worst {slowest.seconds:.0f}s at {slowest.entrance}, "
        f"{trains_per_hour(found):.1f} trains an hour"
    )
