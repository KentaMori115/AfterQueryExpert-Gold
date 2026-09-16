"""How far it is from one thing to another, following the rails.

Every question on site is a distance: how far is the signal from the points, how
far back does the overlap go, how much room is there between these two joints.
Straight line distance is no use for any of them, so this measures along the
track, following the points the way they would be lying for the move.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..errors import TopologyError
from ..units import Distance
from .graph import Sense
from .position import Lies, Position
from .scheme import Scheme
from .traverse import walk

#: How far to walk before giving up on getting there.
SEARCH = Distance(20000.0)


@dataclass(frozen=True)
class Measurement:
    """A distance from one place to another, and the way it went."""

    start: str
    end: str
    distance: Distance
    edges: tuple[str, ...]

    @property
    def metres(self) -> float:
        return self.distance.metres

    def __str__(self) -> str:
        return f"{self.start} to {self.end}: {self.distance}"


def position_of(scheme: Scheme, name: str, sense: Sense = Sense.NOMINAL) -> Position:
    """Where a named thing is, whatever kind of thing it is."""
    if name in scheme.signals:
        return scheme.signal(name).position
    if name in scheme.crossings:
        return scheme.crossing(name).position
    if name in scheme.traps:
        return scheme.trap(name).position
    if name in scheme.graph.nodes:
        node = scheme.graph.node(name)
        _port, edge_name = next(iter(sorted(node.ports.items(), key=lambda i: str(i[0]))))
        edge = scheme.graph.edge(edge_name)
        offset = Distance(0.0) if edge.start.node == name else edge.length
        return Position(edge_name, offset, sense)
    if name in scheme.graph.edges:
        return Position(name, Distance(0.0), sense)
    raise TopologyError(f"nothing called {name} to measure from")


def between(
    scheme: Scheme,
    start: str,
    end: str,
    *,
    lies: Lies | None = None,
    search: Distance = SEARCH,
) -> Measurement | None:
    """The distance along the track from one thing to another, if it can be walked."""
    here = position_of(scheme, start)
    target = position_of(scheme, end)

    for sense in (here.sense, here.sense.opposite):
        found = _walk_to(scheme, here.with_sense(sense), target, lies, search)
        if found is not None:
            return Measurement(start, end, Distance(found[0]), found[1])
    return None


def _walk_to(
    scheme: Scheme,
    here: Position,
    target: Position,
    lies: Lies | None,
    search: Distance,
) -> tuple[float, tuple[str, ...]] | None:
    edges: list[str] = []
    for step in walk(scheme.graph, here, limit=search, lies=lies):
        edges.append(step.edge)
        if step.edge != target.edge:
            continue
        if step.travelled.metres == 0.0:
            gap = _gap(here, target)
        else:
            length = scheme.graph.edge(step.edge).length.metres
            entry = 0.0 if step.sense is Sense.NOMINAL else length
            gap = abs(target.offset.metres - entry)
        if gap < 0:
            continue
        return step.travelled.metres + gap, tuple(edges)
    return None


def _gap(here: Position, target: Position) -> float:
    if here.sense is Sense.NOMINAL:
        return target.offset.metres - here.offset.metres
    return here.offset.metres - target.offset.metres
