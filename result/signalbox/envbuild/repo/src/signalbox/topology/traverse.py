"""One way of walking the graph, used by everything that walks it.

Looking for the signal ahead, the berth behind, the sections a train would be
approaching over and the thing that protects a flank are all the same walk with
a different question asked at each edge. Writing that walk four times produced
four slightly different answers to what happens at a set of points, which is not
a difference anybody wanted.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass

from ..units import Distance
from .graph import Lie, Sense, TrackGraph
from .position import Lies, Position, lie_of

#: Asked before stepping onto an edge. Returning False ends the walk.
Allow = Callable[[str, Sense], bool]


@dataclass(frozen=True)
class Step:
    """One edge of a walk, and how far the walk had gone when it got there."""

    position: Position
    travelled: Distance

    @property
    def edge(self) -> str:
        return self.position.edge

    @property
    def sense(self) -> Sense:
        return self.position.sense

    def remaining(self, graph: TrackGraph) -> Distance:
        return self.position.remaining(graph)

    def __str__(self) -> str:
        return f"{self.position} after {self.travelled.metres:.0f}m"


def entry_position(graph: TrackGraph, edge: str, sense: Sense) -> Position:
    """Standing at the end of an edge a train travelling in ``sense`` enters by."""
    offset = Distance(0.0) if sense is Sense.NOMINAL else graph.edge(edge).length
    return Position(edge, offset, sense)


def walk(
    graph: TrackGraph,
    start: Position,
    *,
    limit: Distance,
    lies: Lies | None = None,
    allow: Allow | None = None,
) -> Iterator[Step]:
    """Walk forward from ``start``, one edge at a time, up to ``limit``.

    The first step is the edge ``start`` is on, and the distance reported with
    it is zero. Where the points can go two ways the walk follows the way they
    are lying, which is normal unless ``lies`` says otherwise. It stops at a
    dead end, at the limit, at an edge ``allow`` refuses, or rather than going
    round a loop.
    """
    here = start
    travelled = 0.0
    seen: set[str] = set()

    while travelled <= limit.metres:
        yield Step(here, Distance(travelled))
        travelled += here.remaining(graph).metres
        seen.add(here.edge)

        port = graph.edge(here.edge).port_for(here.sense)
        onward = [
            step
            for step in graph.step(here.edge, here.sense, lie_of(lies or {}, port.node))
            if step[0] not in seen
        ]
        if not onward:
            return
        next_edge, next_sense = onward[0]
        if allow is not None and not allow(next_edge, next_sense):
            return
        here = entry_position(graph, next_edge, next_sense)


def worked_in(graph: TrackGraph, sense_wanted: Sense | None = None) -> Allow:
    """An ``allow`` that keeps the walk on track worked in the right direction."""

    def allow(edge: str, sense: Sense) -> bool:
        return graph.edge(edge).permits(sense_wanted or sense)

    return allow


def against_the_flow(graph: TrackGraph) -> Allow:
    """An ``allow`` for walking back the way a train would have come."""

    def allow(edge: str, sense: Sense) -> bool:
        return graph.edge(edge).permits(sense.opposite)

    return allow


def both_ways(
    graph: TrackGraph, edge: str, sense: Sense, lie: Lie = Lie.NORMAL
) -> list[tuple[str, Sense]]:
    """Every edge reachable off the end of one, whichever way the points lie."""
    found = list(graph.step(edge, sense, lie))
    other = graph.step(edge, sense, lie.opposite)
    for step in other:
        if step not in found:
            found.append(step)
    return found
