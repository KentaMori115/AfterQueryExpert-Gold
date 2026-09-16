"""Counting heads, and the reset zones a counted section sits in.

A track circuit is bounded by insulated joints and the rails between them are
the section. An axle counter is bounded by nothing in the track at all: it is
bounded by counting heads, and the section is clear when every axle counted in
at one head has been counted out at another. Two things follow, and neither is
written anywhere in the plan.

The first is where the heads go. A counted section needs a head at every leg of
itself that a train can leave by onto track the section does not cover. Legs it
shares with nothing, because they run into a buffer stop, need none: no axle
passes a dead end. A leg that runs to the edge of the scheme does need one, and
so does every leg of a set of points, a crossing or a slip, because each of
those is separate rail and a head on one says nothing about another.

The second is what has to be reset together. A count is only meaningful over
track a train cannot enter or leave unseen, so counted sections a train can run
directly between keep one another honest and are reset as a group. Those groups
are the reset zones. Running directly between is the whole of it: two sections
on the two legs of the same points are not a pair, because no train runs from
one to the other without going over the toe first.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ..layout.ast import NodeKind
from .graph import Lie, Sense, TrackGraph
from .section import Section, SectionMap

#: Node kinds the plan language gives named legs to, so a head can sit on one.
_LEGGED = (NodeKind.POINTS, NodeKind.CROSSING, NodeKind.SLIP)


@dataclass(frozen=True)
class Head:
    """One counting head: a leg of a counted section, at the node it stops at."""

    node: str
    port: str | None
    section: str
    edge: str

    @property
    def name(self) -> str:
        return f"{self.node}.{self.port}" if self.port else self.node

    def __str__(self) -> str:
        return f"{self.name} on {self.section}"


@dataclass(frozen=True)
class ResetZone:
    """Counted sections a train can run directly between, reset as a group."""

    name: str
    sections: tuple[str, ...]

    @property
    def is_single(self) -> bool:
        return len(self.sections) == 1

    def covers(self, section: str) -> bool:
        return section in self.sections

    def __str__(self) -> str:
        return f"{self.name}: {', '.join(self.sections)}"


def counted_sections(sections: SectionMap) -> list[Section]:
    """Every axle counter section, in name order."""
    return sections.counted()


def _onward(graph: TrackGraph, edge: str) -> Iterator[tuple[str, str | None, str]]:
    """Every (from_port, to_edge) a train can take off either end of an edge.

    Yields the port of ``edge`` the train leaves by, together with the edge it
    arrives on, over both lies of anything movable in the way.

    Both lies matter and the direction the track is worked in does not. A set of
    points spends its life being called one way and then the other, so a section
    beyond the reverse leg is reachable whatever the blades happen to be doing
    when the question is asked. The worked direction is left out for a different
    reason: it says which way trains are signalled, not which pieces of rail are
    joined, and a count is kept by rail rather than by timetable.
    """
    for sense in (Sense.NOMINAL, Sense.REVERSE):
        port = graph.edge(edge).port_for(sense)
        for lie in (Lie.NORMAL, Lie.REVERSE):
            for next_edge, _next_sense in graph.step(edge, sense, lie):
                yield port.node, port.name, next_edge


def heads_for(graph: TrackGraph, sections: SectionMap) -> list[Head]:
    """Every counting head a scheme's counted sections ask for.

    One per leg of a counted section that a train can leave by onto track the
    section does not cover, plus one for every leg that runs to the boundary of
    the scheme. A leg that ends at a buffer stop gets none.
    """
    found: dict[tuple[str, str | None, str], Head] = {}
    for section in counted_sections(sections):
        for edge in section.edges:
            for node, port, onward_edge in _onward(graph, edge):
                if sections.name_for(onward_edge) == section.name:
                    continue
                _remember(found, graph, node, port, section.name, edge)
            for node, port in _ends_of(graph, edge):
                if graph.node(node).kind is NodeKind.BOUNDARY:
                    _remember(found, graph, node, port, section.name, edge)
    return sorted(found.values(), key=lambda head: (head.section, head.name))


def _remember(
    found: dict[tuple[str, str | None, str], Head],
    graph: TrackGraph,
    node: str,
    port: str | None,
    section: str,
    edge: str,
) -> None:
    """Record one head, keeping the leg only where the plan gives legs names.

    A plain join, a buffer stop and a boundary have one place for a head and no
    name for it, so the head is the node. Points, a crossing and a slip are
    written in the plan with their legs named, and the head goes on the leg.
    """
    named = graph.node(node).kind in _LEGGED
    key = (node, port if named else None, section)
    found.setdefault(key, Head(node, port if named else None, section, edge))


def _ends_of(graph: TrackGraph, edge_name: str) -> list[tuple[str, str | None]]:
    edge = graph.edge(edge_name)
    return [(port.node, port.name) for port in (edge.start, edge.end)]


def adjacent_counted(graph: TrackGraph, sections: SectionMap) -> dict[str, set[str]]:
    """Counted sections a train can run directly between, both ways round."""
    joined: dict[str, set[str]] = {
        section.name: set() for section in counted_sections(sections)
    }
    for section in counted_sections(sections):
        for edge in section.edges:
            for _node, _port, onward_edge in _onward(graph, edge):
                other = sections.name_for(onward_edge)
                if other is None or other == section.name:
                    continue
                if other in joined:
                    joined[section.name].add(other)
                    joined[other].add(section.name)
    return joined


def zones_for(graph: TrackGraph, sections: SectionMap) -> list[ResetZone]:
    """Group counted sections into reset zones, named for their first section.

    The grouping is the connected components of the adjacency above, walked
    breadth first from the lowest name so that the answer does not depend on
    the order the sections were declared in. Naming a zone for the first of its
    members keeps the name stable while the sections are, which matters because
    the name reaches the interchange file and a comparison between two files is
    made on it.
    """
    joined = adjacent_counted(graph, sections)
    seen: set[str] = set()
    zones: list[ResetZone] = []
    for name in sorted(joined):
        if name in seen:
            continue
        members: list[str] = []
        stack = [name]
        while stack:
            here = stack.pop()
            if here in seen:
                continue
            seen.add(here)
            members.append(here)
            stack.extend(sorted(joined[here] - seen))
        members.sort()
        zones.append(ResetZone(name=members[0], sections=tuple(members)))
    return sorted(zones, key=lambda zone: zone.name)


class CountingPlan:
    """The heads and reset zones of one scheme, with the lookups worth having.

    Built once and asked many times. Every reader of this wants one of three
    questions answered: what heads does this section need, what else comes out
    of use when this section is reset, and which zones are wide enough to be
    worth mentioning to a designer.
    """

    def __init__(self, heads: list[Head], zones: list[ResetZone]) -> None:
        self.heads = heads
        self.zones = zones
        self._zone_of: dict[str, ResetZone] = {}
        for zone in zones:
            for section in zone.sections:
                self._zone_of[section] = zone

    def __len__(self) -> int:
        return len(self.heads)

    def __iter__(self) -> Iterator[Head]:
        return iter(self.heads)

    def zone_of(self, section: str) -> ResetZone | None:
        """The reset zone a section is in, or None if it is not counted."""
        return self._zone_of.get(section)

    def zone(self, name: str) -> ResetZone:
        for zone in self.zones:
            if zone.name == name:
                return zone
        raise KeyError(f"no reset zone called {name}")

    def together(self, section: str) -> tuple[str, ...]:
        """Sections reset alongside this one, itself included, or none at all."""
        zone = self.zone_of(section)
        return zone.sections if zone else ()

    def shares(self, first: str, second: str) -> bool:
        """Whether two sections are reset together."""
        zone = self.zone_of(first)
        return zone is not None and zone.covers(second)

    def heads_at(self, node: str) -> list[Head]:
        return [head for head in self.heads if head.node == node]

    def heads_for_section(self, section: str) -> list[Head]:
        return [head for head in self.heads if head.section == section]

    def wide_zones(self) -> list[ResetZone]:
        """Zones holding more than one section, which is what costs availability."""
        return [zone for zone in self.zones if not zone.is_single]

    def describe(self) -> str:
        return f"{len(self.heads)} counting heads over {len(self.zones)} reset zones"


def build_counting(graph: TrackGraph, sections: SectionMap) -> CountingPlan:
    """Work out the counting heads and the reset zones for one scheme."""
    return CountingPlan(heads_for(graph, sections), zones_for(graph, sections))
