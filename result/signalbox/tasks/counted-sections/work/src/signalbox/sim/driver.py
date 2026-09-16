"""How fast a driver would be going, given what is in front of them.

The driver is not clever. They look ahead for the next signal, take the aspect
it is showing, and choose a speed they could still stop from. That is enough to
make a simulation that behaves like a railway: trains bunch up behind a red,
double yellows keep them moving, and a signal that clears late costs a train
time it does not get back.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..signalling.braking import BrakingModel
from ..signalling.signal import Aspect
from ..topology.graph import Sense
from ..topology.position import Lies, Position
from ..topology.scheme import Scheme
from ..topology.traverse import walk
from ..units import Distance, Speed

#: How far ahead a driver is taken to be able to see and plan.
LOOKAHEAD = Distance(3000.0)

#: How far short of a red signal a driver aims to stop.
STOP_MARGIN = Distance(20.0)

#: How many blocks of room a driver assumes each aspect is worth.
BLOCKS_FOR = {
    Aspect.RED: 0.0,
    Aspect.YELLOW: 1.0,
    Aspect.DOUBLE_YELLOW: 2.0,
    Aspect.GREEN: 4.0,
}


@dataclass(frozen=True)
class Sighting:
    """The next signal a driver can see, and what it is showing."""

    signal: str
    distance: Distance
    aspect: Aspect

    @property
    def is_stop(self) -> bool:
        return self.aspect.is_stop

    def __str__(self) -> str:
        return f"{self.signal} at {self.distance.metres:.0f}m showing {self.aspect}"


def signal_ahead(
    scheme: Scheme,
    front: Position,
    lies: Lies | None = None,
    *,
    limit: Distance = LOOKAHEAD,
) -> tuple[str, Distance] | None:
    """The first signal facing the way we are going, and how far off it is."""
    for step in walk(scheme.graph, front, limit=limit, lies=lies):
        for signal in scheme.signals_on(step.edge):
            if signal.position.sense is not step.sense:
                continue
            gap = _gap_to(step.position, signal.position)
            if gap is None or gap <= 0:
                continue
            reached = step.travelled.metres + gap
            if reached <= limit.metres:
                return signal.name, Distance(reached)
    return None


def _gap_to(here: Position, other: Position) -> float | None:
    if here.sense is Sense.NOMINAL:
        return other.offset.metres - here.offset.metres
    return here.offset.metres - other.offset.metres


@dataclass
class Driver:
    """The rules one driver follows."""

    braking: BrakingModel = field(default_factory=BrakingModel)
    margin: Distance = STOP_MARGIN

    def stopping_speed(self, room: Distance) -> Speed:
        """The fastest a train could be going and still stop in ``room``."""
        usable = max(room.metres - self.margin.metres, 0.0)
        if usable <= 0:
            return Speed(0.0)
        return Speed((2.0 * self.braking.rate * usable) ** 0.5)

    def target_speed(
        self,
        line_speed: Speed,
        sighting: Sighting | None,
        *,
        block: Distance | None = None,
    ) -> Speed:
        """The speed to be doing now, given the road ahead."""
        if sighting is None:
            return line_speed
        blocks = BLOCKS_FOR[sighting.aspect]
        room = sighting.distance.metres
        if blocks and block is not None:
            room += blocks * block.metres
        elif blocks:
            room += blocks * sighting.distance.metres
        allowed = self.stopping_speed(Distance(room))
        return Speed(min(line_speed.mps, allowed.mps))

    def should_stop(self, sighting: Sighting | None) -> bool:
        return sighting is not None and sighting.is_stop and sighting.distance <= self.margin
