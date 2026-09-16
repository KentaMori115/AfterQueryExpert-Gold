"""What can be got to from where, which is the first question about a layout.

A siding nothing can reach is a drafting mistake. So is a platform that can be
reached but not left, and so is a whole corner of a scheme that is only joined
to the rest through points that no route ever calls. All three come out of the
same walk, so they live together.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from ..layout.ast import NodeKind
from .graph import Lie, Sense
from .position import Position
from .scheme import Scheme


@dataclass
class Reach:
    """The edges a walk got to, and the direction it got to them in."""

    edges: set[str] = field(default_factory=set)
    senses: set[tuple[str, Sense]] = field(default_factory=set)

    def __contains__(self, edge: object) -> bool:
        return edge in self.edges

    def __len__(self) -> int:
        return len(self.edges)

    def reached(self, edge: str, sense: Sense | None = None) -> bool:
        if sense is None:
            return edge in self.edges
        return (edge, sense) in self.senses


def _entries(scheme: Scheme) -> list[Position]:
    """A position just inside the scheme at every boundary, facing inwards."""
    found: list[Position] = []
    for name, node in sorted(scheme.graph.nodes.items()):
        if node.kind is not NodeKind.BOUNDARY:
            continue
        for edge_name in node.ports.values():
            edge = scheme.graph.edge(edge_name)
            sense = edge.sense_leaving(edge.start if edge.start.node == name else edge.end)
            offset = (
                edge.length
                if sense is Sense.REVERSE
                else scheme.graph.edge(edge_name).length * 0
            )
            found.append(Position(edge_name, offset, sense))
    return found


def reachable(scheme: Scheme, *, respect_direction: bool = True) -> Reach:
    """Every edge a train could get to from a boundary."""
    reach = Reach()
    queue: deque[tuple[str, Sense]] = deque()

    for entry in _entries(scheme):
        edge = scheme.graph.edge(entry.edge)
        if respect_direction and not edge.permits(entry.sense):
            continue
        queue.append((entry.edge, entry.sense))

    while queue:
        edge_name, sense = queue.popleft()
        if (edge_name, sense) in reach.senses:
            continue
        reach.senses.add((edge_name, sense))
        reach.edges.add(edge_name)
        for lie in (Lie.NORMAL, Lie.REVERSE):
            for next_edge, next_sense in scheme.graph.step(edge_name, sense, lie):
                if respect_direction and not scheme.graph.edge(next_edge).permits(next_sense):
                    continue
                if (next_edge, next_sense) not in reach.senses:
                    queue.append((next_edge, next_sense))
    return reach


def unreachable_edges(scheme: Scheme, *, respect_direction: bool = True) -> list[str]:
    reach = reachable(scheme, respect_direction=respect_direction)
    return sorted(name for name in scheme.graph.edges if name not in reach)


def unreachable_sections(scheme: Scheme, *, respect_direction: bool = True) -> list[str]:
    stranded = set(unreachable_edges(scheme, respect_direction=respect_direction))
    found = {
        scheme.sections.name_for(edge)
        for edge in stranded
        if scheme.sections.name_for(edge) is not None
    }
    return sorted(name for name in found if name is not None)


def dead_ends(scheme: Scheme) -> list[str]:
    """Sidings a train can get into but not back out of.

    Running into a buffer stop is normal; what is not normal is a siding whose
    direction of working does not let a train set back out of it again, because
    then anything that goes in stays there.
    """
    reach = reachable(scheme)
    stuck = []
    for name in sorted(reach.edges):
        senses = {sense for edge, sense in reach.senses if edge == name}
        if len(senses) != 1:
            continue
        sense = next(iter(senses))
        edge = scheme.graph.edge(name)
        far = edge.port_for(sense)
        if scheme.graph.node(far.node).kind is not NodeKind.BUFFER:
            continue
        if not edge.permits(sense.opposite):
            stuck.append(name)
    return stuck
