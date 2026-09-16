"""Routes: a signal, an exit, and everything that has to be true in between.

A route is the unit the signaller actually sets. It names the signal it starts
at, the signal it ends at, the class of move it permits, the points it needs and
the track it runs over. Overlaps, flank protection and locking all hang off it
but are worked out later, so a route on its own stays comparable and printable.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum

from ..errors import RoutingError
from ..topology.graph import Lie
from ..topology.walk import Path
from ..units import Distance


class RouteClass(Enum):
    """What kind of move the route lets a driver make.

    The order matters: a signaller offered several routes between the same two
    signals will be given the least restrictive one that is available, and the
    control table prints them in this order.
    """

    MAIN = "M"
    WARNING = "W"
    CALL_ON = "C"
    SHUNT = "S"

    @property
    def is_main(self) -> bool:
        return self is RouteClass.MAIN

    @property
    def clears_signal(self) -> bool:
        """Whether setting the route can put a proceed aspect on the signal."""
        return self in (RouteClass.MAIN, RouteClass.WARNING)

    @property
    def permits_occupied_track(self) -> bool:
        """Call on and shunt moves may be signalled into an occupied section."""
        return self in (RouteClass.CALL_ON, RouteClass.SHUNT)

    def __str__(self) -> str:
        return self.value


class EndKind(Enum):
    """What a route finishes at."""

    SIGNAL = "signal"
    BOUNDARY = "boundary"
    BUFFER = "buffer"

    @property
    def is_signal(self) -> bool:
        return self is EndKind.SIGNAL


@dataclass(frozen=True)
class RouteEnd:
    """Where a route stops: another signal, the scheme boundary, or a dead end.

    Not every route ends at a signal. The last signal before the edge of the
    scheme has a route out to the boundary, and a shunt into a siding ends at
    the buffer stop. Both still have to be in the control table.
    """

    name: str
    kind: EndKind = EndKind.SIGNAL

    @classmethod
    def signal(cls, name: str) -> RouteEnd:
        return cls(name, EndKind.SIGNAL)

    @classmethod
    def boundary(cls, name: str) -> RouteEnd:
        return cls(name, EndKind.BOUNDARY)

    @classmethod
    def buffer_stop(cls, name: str) -> RouteEnd:
        return cls(name, EndKind.BUFFER)

    @property
    def is_signal(self) -> bool:
        return self.kind.is_signal

    def __str__(self) -> str:
        if self.kind is EndKind.SIGNAL:
            return self.name
        return f"{self.name} ({self.kind.value})"


@dataclass(frozen=True)
class Route:
    """One entry in the control table."""

    entrance: str
    exit: RouteEnd
    klass: RouteClass
    path: Path
    points: Mapping[str, Lie] = field(default_factory=dict)
    sections: tuple[str, ...] = ()
    suffix: str = ""

    def __post_init__(self) -> None:
        if self.entrance == self.exit.name:
            raise RoutingError(f"route at {self.entrance} ends where it starts")
        if not self.path.steps:
            raise RoutingError(f"route {self.entrance} to {self.exit.name} covers no track")

    @property
    def name(self) -> str:
        """The name the route is known by, such as ``K1(M)`` or ``K1(MA)``."""
        return f"{self.entrance}({self.klass.value}{self.suffix})"

    @property
    def full_name(self) -> str:
        return f"{self.name} to {self.exit}"

    @property
    def ends_at_a_signal(self) -> bool:
        return self.exit.is_signal

    @property
    def length(self) -> Distance:
        return self.path.length

    @property
    def edges(self) -> tuple[str, ...]:
        return self.path.edges

    @property
    def covered_edges(self) -> tuple[str, ...]:
        """The route's edges, with the one its signal stands on in front.

        A signal standing on a joint has none of its own edge in front of it, so
        that edge is not part of the route. It is still the edge the route comes
        out of, and anything that walks the nodes a route passes through has to
        start from it or it misses the first set of points.
        """
        start = self.path.start.edge
        if self.edges and self.edges[0] == start:
            return self.edges
        return (start, *self.edges)

    def uses_section(self, section: str) -> bool:
        return section in self.sections

    def uses_edge(self, edge: str) -> bool:
        return self.path.uses(edge)

    def needs(self, node: str) -> Lie | None:
        return self.points.get(node)

    def points_against(self, other: Route) -> set[str]:
        """Points the two routes want lying opposite ways."""
        return {
            node
            for node, lie in self.points.items()
            if other.points.get(node) not in (None, lie)
        }

    def shares_track_with(self, other: Route) -> set[str]:
        return set(self.sections) & set(other.sections)

    def __str__(self) -> str:
        return self.full_name
