"""Sub routes: one section held in one direction.

This is the unit everything about holding track is expressed in. A section on
its own is not enough, because the interlocking has to be able to tell a route
running east over a piece of track from one running west over it, and to allow
a route to take over track another route is only holding as its overlap.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..topology.graph import Sense
from ..topology.scheme import Scheme


@dataclass(frozen=True)
class Subroute:
    """One section, with the direction a train runs through it."""

    section: str
    ends: str

    @property
    def name(self) -> str:
        return f"{self.section}-{self.ends}"

    @property
    def reverse(self) -> Subroute:
        return Subroute(self.section, self.ends[::-1])

    def opposes(self, other: Subroute) -> bool:
        return self.section == other.section and self.ends != other.ends

    def same_track_as(self, other: Subroute) -> bool:
        return self.section == other.section

    def __str__(self) -> str:
        return self.name


def ends_for(sense: Sense) -> str:
    """The two letters used to write a direction of travel through a section."""
    return "AB" if sense is Sense.NOMINAL else "BA"


def subroutes_over(
    scheme: Scheme, steps: tuple[tuple[str, Sense], ...]
) -> tuple[Subroute, ...]:
    """Sub routes for a run of edges, one per section, in the order travelled."""
    found: list[Subroute] = []
    for edge, sense in steps:
        section = scheme.sections.name_for(edge)
        if section is None:
            continue
        if found and found[-1].section == section:
            continue
        found.append(Subroute(section, ends_for(sense)))
    return tuple(found)


def opposed(first: tuple[Subroute, ...], second: tuple[Subroute, ...]) -> list[str]:
    """Sub routes the two runs want in opposite directions."""
    against = {sub.reverse for sub in second}
    return sorted(sub.name for sub in first if sub in against)


def shared(first: tuple[Subroute, ...], second: tuple[Subroute, ...]) -> list[str]:
    """Sections both runs cover, whichever way round."""
    sections = {sub.section for sub in second}
    return sorted({sub.section for sub in first if sub.section in sections})
