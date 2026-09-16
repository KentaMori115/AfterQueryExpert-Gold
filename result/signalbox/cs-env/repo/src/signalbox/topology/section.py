"""Track sections: the pieces of line that report whether a train is on them.

A section is one track circuit or one axle counter section. It covers a set of
edges, and everything about occupancy, route locking and sectional release is
expressed in terms of sections rather than edges, because a section is what the
interlocking can actually see.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from ..errors import TopologyError
from ..layout.ast import SchemeDecl, SectionKind
from ..units import Distance
from .graph import Lie, Sense, TrackGraph
from .walk import Path


@dataclass(frozen=True)
class Section:
    """One detected piece of track."""

    name: str
    kind: SectionKind
    edges: tuple[str, ...]

    @property
    def is_counted(self) -> bool:
        return self.kind is SectionKind.AXLE_COUNTER

    def length(self, graph: TrackGraph) -> Distance:
        return Distance(sum(graph.edge(name).length.metres for name in self.edges))

    def __str__(self) -> str:
        return self.name


class SectionMap:
    """Which section each edge belongs to, and what that means for a path."""

    def __init__(self, sections: Iterable[Section]) -> None:
        self.sections: dict[str, Section] = {}
        self._by_edge: dict[str, str] = {}
        for section in sections:
            if section.name in self.sections:
                raise TopologyError(f"section {section.name} defined twice")
            self.sections[section.name] = section
            for edge in section.edges:
                if edge in self._by_edge:
                    raise TopologyError(
                        f"edge {edge} is in both {self._by_edge[edge]} and {section.name}"
                    )
                self._by_edge[edge] = section.name

    def __len__(self) -> int:
        return len(self.sections)

    def __contains__(self, name: object) -> bool:
        return name in self.sections

    def get(self, name: str) -> Section:
        try:
            return self.sections[name]
        except KeyError:
            raise TopologyError(f"no section called {name}") from None

    def section_for(self, edge: str) -> Section | None:
        name = self._by_edge.get(edge)
        return self.sections[name] if name else None

    def name_for(self, edge: str) -> str | None:
        return self._by_edge.get(edge)

    def over_path(self, path: Path) -> list[Section]:
        """The sections a path runs through, in order, without repeats."""
        ordered: list[Section] = []
        for edge, _sense in path.steps:
            section = self.section_for(edge)
            if section is None:
                continue
            if not ordered or ordered[-1].name != section.name:
                ordered.append(section)
        return ordered

    def unassigned(self, graph: TrackGraph) -> list[str]:
        """Edges that no section covers, which usually means a drafting slip."""
        return sorted(name for name in graph.edges if name not in self._by_edge)

    def neighbours(self, graph: TrackGraph, name: str) -> set[str]:
        """Sections that touch this one, in either direction."""
        section = self.get(name)
        found: set[str] = set()
        for edge in section.edges:
            for sense in (Sense.NOMINAL, Sense.REVERSE):
                for next_edge, _ in graph.step(edge, sense):
                    other = self._by_edge.get(next_edge)
                    if other is not None and other != name:
                        found.add(other)
                for lie_step in graph.step(edge, sense, Lie.REVERSE):
                    other = self._by_edge.get(lie_step[0])
                    if other is not None and other != name:
                        found.add(other)
        return found


def build_sections(scheme: SchemeDecl) -> SectionMap:
    return SectionMap(
        Section(decl.name, decl.kind, tuple(decl.edges)) for decl in scheme.sections
    )
