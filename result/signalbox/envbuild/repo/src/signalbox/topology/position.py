"""A place on the track, and how to move away from it.

A position is an edge, a distance along that edge measured from the edge's
declared start, and the direction the thing at that position is facing. Signals,
train fronts, insulated block joints and overlap ends are all positions.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..errors import TopologyError
from ..units import Distance
from .graph import Lie, Sense, TrackGraph

#: How the points are lying, by node name. Anything not mentioned lies normal.
Lies = dict[str, Lie]


@dataclass(frozen=True)
class Position:
    """A point on an edge together with a direction of travel."""

    edge: str
    offset: Distance
    sense: Sense = Sense.NOMINAL

    @classmethod
    def at_start(cls, edge: str, sense: Sense = Sense.NOMINAL) -> Position:
        return cls(edge, Distance(0.0), sense)

    def with_sense(self, sense: Sense) -> Position:
        """The same place, facing whichever way is asked for."""
        return replace(self, sense=sense)

    @property
    def reversed(self) -> Position:
        """The same place, facing the other way."""
        return replace(self, sense=self.sense.opposite)

    def remaining(self, graph: TrackGraph) -> Distance:
        """How much edge is left in front of this position."""
        length = graph.edge(self.edge).length
        if self.sense is Sense.NOMINAL:
            return Distance(length.metres - self.offset.metres)
        return Distance(self.offset.metres)

    def behind(self, graph: TrackGraph) -> Distance:
        return self.reversed.remaining(graph)

    def __str__(self) -> str:
        arrow = "->" if self.sense is Sense.NOMINAL else "<-"
        return f"{self.edge}{arrow}{self.offset.metres:.0f}m"


def lie_of(lies: Lies, node: str) -> Lie:
    return lies.get(node, Lie.NORMAL)


def advance(
    graph: TrackGraph,
    start: Position,
    distance: Distance,
    lies: Lies | None = None,
) -> Position | None:
    """Move ``distance`` forward from ``start``, or return None if the track runs out.

    Running out means a buffer stop, the edge of the scheme, or a set of points
    lying against the move.
    """
    lies = lies or {}
    if distance.metres < 0:
        raise TopologyError("advance takes a forward distance, reverse the position instead")

    here = start
    left = distance.metres
    while True:
        available = here.remaining(graph).metres
        if left <= available:
            step = left if here.sense is Sense.NOMINAL else -left
            return replace(here, offset=Distance(here.offset.metres + step))
        left -= available
        port = graph.edge(here.edge).port_for(here.sense)
        onward = graph.step(here.edge, here.sense, lie_of(lies, port.node))
        if not onward:
            return None
        next_edge, next_sense = onward[0]
        edge = graph.edge(next_edge)
        start_offset = 0.0 if next_sense is Sense.NOMINAL else edge.length.metres
        here = Position(next_edge, Distance(start_offset), next_sense)


def distance_between(
    graph: TrackGraph,
    start: Position,
    target: Position,
    lies: Lies | None = None,
    limit: Distance | None = None,
) -> Distance | None:
    """Distance forward from ``start`` to ``target``, following ``lies``.

    Returns None if the target is not ahead within ``limit``. The target's own
    sense is ignored; only where it sits matters.
    """
    lies = lies or {}
    ceiling = limit.metres if limit is not None else float("inf")
    travelled = 0.0
    here = start

    while travelled <= ceiling:
        if here.edge == target.edge:
            if here.sense is Sense.NOMINAL and target.offset >= here.offset:
                gap = target.offset.metres - here.offset.metres
                return Distance(travelled + gap) if travelled + gap <= ceiling else None
            if here.sense is Sense.REVERSE and target.offset <= here.offset:
                gap = here.offset.metres - target.offset.metres
                return Distance(travelled + gap) if travelled + gap <= ceiling else None
        travelled += here.remaining(graph).metres
        port = graph.edge(here.edge).port_for(here.sense)
        onward = graph.step(here.edge, here.sense, lie_of(lies, port.node))
        if not onward:
            return None
        next_edge, next_sense = onward[0]
        edge = graph.edge(next_edge)
        offset = 0.0 if next_sense is Sense.NOMINAL else edge.length.metres
        here = Position(next_edge, Distance(offset), next_sense)
        if here.edge == start.edge and here.sense == start.sense:
            return None
    return None
