"""Level crossings, and what a route running over one has to prove.

Crossings divide into the ones the interlocking is responsible for and the ones
it is not. A manually controlled barrier has to be down and proved down before
the signal in rear of it will clear. An automatic half barrier looks after
itself and the interlocking only needs to know it is there, because the strike
in point still has to be far enough back for the road traffic to get the warning
it is entitled to.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..layout.ast import CrossingKind
from ..topology.position import Position
from ..units import Distance, Speed

if TYPE_CHECKING:  # pragma: no cover - imported for types only
    from ..topology.scheme import Scheme
    from .interlocking import RoutePlan

#: The warning time road users get before a train arrives, in seconds.
DEFAULT_STRIKE_IN = 27.0


@dataclass(frozen=True)
class Crossing:
    """One level crossing, standing at a position on the track."""

    name: str
    position: Position
    kind: CrossingKind = CrossingKind.MANUAL_BARRIER
    strike_in: float = DEFAULT_STRIKE_IN
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def edge(self) -> str:
        return self.position.edge

    @property
    def interlocked(self) -> bool:
        return self.kind.is_protected

    def requirement(self) -> str:
        """What a route over this crossing has to prove."""
        if self.kind is CrossingKind.OBSTACLE_DETECTED:
            return f"{self.name} barriers down and road clear"
        if self.kind is CrossingKind.MANUAL_BARRIER:
            return f"{self.name} barriers down"
        if self.kind is CrossingKind.AUTOMATIC_HALF:
            return f"{self.name} strike in only"
        if self.kind is CrossingKind.USER_WORKED:
            return f"{self.name} telephone"
        return f"{self.name} nothing"

    def strike_in_distance(self, speed: Speed) -> Distance:
        """How far back from the crossing the train has to be detected."""
        return Distance(speed.mps * self.strike_in)

    def __str__(self) -> str:
        return f"{self.name} ({self.kind.value}) on {self.position}"


def crossings_over(scheme: Scheme, plan: RoutePlan) -> list[Crossing]:
    """The crossings a route runs over, in the order the train meets them."""
    found: list[tuple[int, float, Crossing]] = []
    edges = plan.route.edges
    start = plan.route.path.start
    finish = _finish_position(scheme, plan)

    for crossing in scheme.crossings.values():
        if crossing.edge not in edges:
            continue
        index = edges.index(crossing.edge)
        # The start and finish checks only mean anything on the edge the signal
        # in question actually stands on. A signal on a joint reads over the
        # whole of the first edge of its route.
        if crossing.edge == start.edge and not _ahead_of(
            start, crossing.position.offset.metres
        ):
            continue
        beyond_the_exit = (
            finish is not None
            and crossing.edge == finish.edge
            and not _ahead_of(crossing.position.with_sense(finish.sense), finish.offset.metres)
        )
        if beyond_the_exit:
            continue
        found.append((index, crossing.position.offset.metres, crossing))

    found.sort(key=lambda item: (item[0], item[1]))
    return [crossing for _index, _offset, crossing in found]


def _finish_position(scheme: Scheme, plan: RoutePlan) -> Position | None:
    if not plan.route.exit.is_signal:
        return None
    found: Position = scheme.signal(plan.route.exit.name).position
    return found


def _ahead_of(here: Position, offset: float) -> bool:
    from ..topology.graph import Sense

    if here.sense is Sense.NOMINAL:
        return offset >= here.offset.metres
    return offset <= here.offset.metres


def interlocked_over(scheme: Scheme, plan: RoutePlan) -> list[Crossing]:
    return [crossing for crossing in crossings_over(scheme, plan) if crossing.interlocked]


def requirements_for(scheme: Scheme, plan: RoutePlan) -> tuple[str, ...]:
    return tuple(crossing.requirement() for crossing in crossings_over(scheme, plan))
