"""Mileage: where things are on the ground, rather than where they are in the graph.

The graph knows that one edge follows another and how long each of them is. It
does not know that the junction is at twelve miles thirty four chains, which is
what everybody on site will call it. Give one edge a mileage and the rest follow
from the lengths, which is exactly how a real plan is dimensioned.

Mileage increases in the down direction, so an edge drawn the usual way has its
declared mileage at its start and a larger one at its end.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from ..errors import TopologyError
from ..units import Distance, mileage
from .graph import Sense
from .position import Position
from .scheme import Scheme


@dataclass
class Chainage:
    """The mileage of every node the datum could be carried to."""

    nodes: dict[str, Distance] = field(default_factory=dict)
    datum: str | None = None

    @property
    def is_empty(self) -> bool:
        return not self.nodes

    def at(self, node: str) -> Distance:
        try:
            return self.nodes[node]
        except KeyError:
            raise TopologyError(f"no mileage worked out for {node}") from None

    def known(self, node: str) -> bool:
        return node in self.nodes

    def of(self, scheme: Scheme, position: Position) -> Distance:
        """The mileage of a position along an edge."""
        edge = scheme.graph.edge(position.edge)
        start = self.at(edge.start.node)
        return Distance(start.metres + position.offset.metres)

    def missing(self, scheme: Scheme) -> list[str]:
        return sorted(name for name in scheme.graph.nodes if name not in self.nodes)

    def describe(self) -> str:
        if self.is_empty:
            return "no mileage in this scheme"
        lowest = min(self.nodes.values(), key=lambda d: d.metres)
        highest = max(self.nodes.values(), key=lambda d: d.metres)
        return f"{lowest} to {highest} from {self.datum or 'the first edge'}"


def declared(scheme: Scheme) -> dict[str, Distance]:
    """The mileages written on edges in the plan, keyed by the node they fix."""
    return dict(sorted(scheme.mileages.items()))


def chainage(scheme: Scheme, *, datum: str | None = None) -> Chainage:
    """Work the mileage out for every node reachable from a datum."""
    known = scheme.mileages
    if datum is None:
        datum = next(iter(sorted(known)), None)
    if datum is None:
        return Chainage()
    if datum not in scheme.graph.nodes:
        raise TopologyError(f"no node called {datum}")

    start = known.get(datum, Distance(0.0))
    result = Chainage(nodes={datum: start}, datum=datum)

    queue: deque[str] = deque([datum])
    while queue:
        name = queue.popleft()
        here = result.nodes[name]
        node = scheme.graph.node(name)
        for port, edge_name in sorted(node.ports.items(), key=lambda item: str(item[0])):
            edge = scheme.graph.edge(edge_name)
            far = edge.end if edge.start.node == name else edge.start
            if far.node in result.nodes:
                continue
            step = edge.length.metres
            leaving = edge.sense_leaving(edge.start if edge.start.node == name else edge.end)
            del port
            onward = step if leaving is Sense.NOMINAL else -step
            result.nodes[far.node] = Distance(here.metres + onward)
            queue.append(far.node)

    return result


def parse_mileage(text: str) -> Distance:
    """Read a mileage written as ``12m 34ch``."""
    return mileage(text)
