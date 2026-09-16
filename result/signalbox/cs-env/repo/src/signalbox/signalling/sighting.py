"""Whether a driver can see the signal in time to do anything about it.

A signal has to be visible for long enough before it is reached that a driver
can read it, decide, and act. The figure is a time rather than a distance, so
the distance follows from line speed: ten seconds at ninety miles an hour is a
quarter of a mile, and on a curve through a cutting that is not always there.

How far a signal can actually be seen from is a site measurement, so it comes
from the plan. A signal that does not say gets the benefit of the doubt and is
reported as unmeasured rather than as failing.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..errors import InterlockingError
from ..topology.scheme import Scheme
from ..units import Distance, Speed
from .signal import Signal

#: How long a driver needs to have the signal in view, in seconds.
READING_TIME = 10.0

#: A shunt signal is read from much closer, because the move is much slower.
SHUNT_READING_TIME = 5.0


class Verdict(Enum):
    """What the sighting distance for one signal comes to."""

    ADEQUATE = "adequate"
    SHORT = "short"
    UNMEASURED = "unmeasured"

    @property
    def is_a_problem(self) -> bool:
        return self is Verdict.SHORT


@dataclass(frozen=True)
class Sighting:
    """The sighting for one signal: what is wanted and what there is."""

    signal: str
    wanted: Distance
    available: Distance | None
    speed: Speed | None

    @property
    def verdict(self) -> Verdict:
        if self.available is None:
            return Verdict.UNMEASURED
        if self.available.metres < self.wanted.metres:
            return Verdict.SHORT
        return Verdict.ADEQUATE

    @property
    def short_by(self) -> Distance:
        if self.available is None or self.verdict is not Verdict.SHORT:
            return Distance(0.0)
        return Distance(self.wanted.metres - self.available.metres)

    def describe(self) -> str:
        if self.available is None:
            return f"{self.signal}: {self.wanted.metres:.0f}m wanted, never measured"
        return (
            f"{self.signal}: {self.available.metres:.0f}m of {self.wanted.metres:.0f}m wanted"
        )

    def __str__(self) -> str:
        return self.describe()


def reading_time(signal: Signal) -> float:
    return SHUNT_READING_TIME if signal.type.value == "shunt" else READING_TIME


def distance_wanted(speed: Speed | None, signal: Signal) -> Distance:
    """How far back a signal of this kind has to be visible from."""
    if speed is None:
        return Distance(0.0)
    return Distance(speed.mps * reading_time(signal))


def measured(signal: Signal) -> Distance | None:
    """What the plan says the signal can be seen from, if it says anything."""
    written = signal.attributes.get("sighting")
    if written is None:
        return None
    try:
        return Distance(float(written))
    except ValueError:
        raise InterlockingError(
            f"signal {signal.name} has a sighting distance of {written!r}"
        ) from None


def sighting_for(scheme: Scheme, signal: Signal) -> Sighting:
    speed = scheme.graph.edge(signal.position.edge).speed
    return Sighting(signal.name, distance_wanted(speed, signal), measured(signal), speed)


def all_sightings(scheme: Scheme) -> list[Sighting]:
    return [sighting_for(scheme, signal) for signal in scheme.sorted_signals()]


def short(sightings: list[Sighting]) -> list[Sighting]:
    return [one for one in sightings if one.verdict is Verdict.SHORT]


def unmeasured(sightings: list[Sighting]) -> list[Sighting]:
    return [one for one in sightings if one.verdict is Verdict.UNMEASURED]
