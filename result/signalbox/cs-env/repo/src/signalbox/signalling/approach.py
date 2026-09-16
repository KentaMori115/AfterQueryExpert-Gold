"""Approach locking: what stops a route being taken away in a driver's face.

Once a signal has been cleared, a driver may already have seen it and started
braking on the strength of it. Putting the signal back and letting something
else move is only safe once the interlocking is sure the train has either
stopped or gone. That certainty comes two ways: watching the track the train
would be on, or waiting long enough that it must have stopped.

The sections watched are the ones between the signal behind and the signal being
cleared, since that is where a train would be if it had seen the aspect.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..topology.position import Position
from ..topology.scheme import Scheme
from ..topology.traverse import against_the_flow, walk
from ..units import Distance, Speed
from .interlocking import RoutePlan
from .signal import Signal

#: The delay used when nothing better can be worked out, in seconds.
DEFAULT_RELEASE_DELAY = 120.0

#: How far back to look for the signal in rear before giving up.
APPROACH_SEARCH = Distance(4000.0)


class ApproachKind(Enum):
    TRACK_AND_TIME = "track and time"
    TIME_ONLY = "time only"
    NONE = "none"

    @property
    def needs_timer(self) -> bool:
        return self is not ApproachKind.NONE


@dataclass(frozen=True)
class ApproachLock:
    """How one route is released once it has been cleared to a driver."""

    route: str
    kind: ApproachKind
    watched: tuple[str, ...] = ()
    delay: float = 0.0

    @property
    def immediate(self) -> bool:
        return self.kind is ApproachKind.NONE

    def describe(self) -> str:
        if self.kind is ApproachKind.NONE:
            return "released as soon as the signal is replaced"
        track = ", ".join(self.watched) if self.watched else "no track"
        return f"{self.kind.value} on {track} after {self.delay:.0f}s"

    def __str__(self) -> str:
        return f"{self.route}: {self.describe()}"


def approach_sections(
    scheme: Scheme, signal: Signal, *, search: Distance = APPROACH_SEARCH
) -> tuple[str, ...]:
    """Sections behind a signal, back as far as the signal in rear."""
    back = Position(
        signal.position.edge, signal.position.offset, signal.position.sense.opposite
    )
    found: list[str] = []

    for step in walk(scheme.graph, back, limit=search, allow=against_the_flow(scheme.graph)):
        section = scheme.sections.name_for(step.edge)
        if section is not None and section not in found:
            found.append(section)
        if _signal_behind(scheme, step.position, signal.name) is not None:
            break

    return tuple(found)


def _signal_behind(scheme: Scheme, here: Position, ignoring: str) -> str | None:
    """A signal on this edge reading towards where we started from."""
    wanted = here.sense.opposite
    candidates = [
        s
        for s in scheme.signals_on(here.edge)
        if s.position.sense is wanted and s.name != ignoring and _behind(here, s.position)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda s: abs(s.position.offset.metres - here.offset.metres))
    return candidates[0].name


def _behind(here: Position, other: Position) -> bool:
    from ..topology.graph import Sense

    if here.sense is Sense.NOMINAL:
        return other.offset.metres >= here.offset.metres
    return other.offset.metres <= here.offset.metres


def release_delay(speed: Speed | None, *, floor: float = DEFAULT_RELEASE_DELAY) -> float:
    """How long to wait before assuming an approaching train has stopped.

    The figure scales with line speed because a faster train takes longer to
    come to a stand from the point at which it saw the aspect.
    """
    if speed is None:
        return floor
    return max(floor, speed.mph * 2.0)


def approach_lock_for(
    scheme: Scheme, plan: RoutePlan, *, search: Distance = APPROACH_SEARCH
) -> ApproachLock:
    """Work out the approach locking for one route."""
    if not plan.klass.clears_signal:
        return ApproachLock(plan.name, ApproachKind.NONE)

    signal = scheme.signal(plan.entrance)
    watched = approach_sections(scheme, signal, search=search)
    speed = scheme.graph.edge(signal.position.edge).speed
    delay = release_delay(speed, floor=scheme.standards.approach)

    kind = ApproachKind.TRACK_AND_TIME if watched else ApproachKind.TIME_ONLY
    return ApproachLock(plan.name, kind, watched, delay)
