"""The shape of a parsed scheme plan.

These are dumb records. They know nothing about whether the layout makes sense;
that is the validator's job. Keeping them free of behaviour means the parser can
be tested on its own and the validator can be given hand built input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class NodeKind(Enum):
    """What sits at a junction between track edges."""

    BOUNDARY = "boundary"
    PLAIN = "plain"
    POINTS = "points"
    BUFFER = "buffer"
    CROSSING = "crossing"
    SLIP = "slip"

    @classmethod
    def from_word(cls, word: str) -> NodeKind | None:
        for member in cls:
            if member.value == word:
                return member
        return None


class Facing(Enum):
    """Which way along its own edge a piece of equipment looks.

    Saying "up" or "down" in the plan would mean the reader has to know which way
    round every edge was drawn before they could tell where a signal points.
    ``forward`` is towards the edge's declared end, ``backward`` towards its
    start. The traffic direction, which is what a signal engineer actually calls
    up or down, is a separate label carried in the signal's attributes.
    """

    FORWARD = "forward"
    BACKWARD = "backward"

    @property
    def opposite(self) -> Facing:
        return Facing.BACKWARD if self is Facing.FORWARD else Facing.FORWARD

    @classmethod
    def from_word(cls, word: str) -> Facing | None:
        for member in cls:
            if member.value == word:
                return member
        return None


class SectionKind(Enum):
    TRACK_CIRCUIT = "track_circuit"
    AXLE_COUNTER = "axle_counter"


#: The named ends of a set of points. ``toe`` is the single end, the other two
#: are the legs the blades select between.
POINT_PORTS = ("toe", "normal", "reverse")

#: A diamond crossing has four ends named by the two roads that cross.
CROSSING_PORTS = ("a1", "a2", "b1", "b2")

#: A slip is a crossing with points in it, so it has the same four ends. Lying
#: normal it is a plain crossing; lying reverse it joins one road to the other.
#: A single slip joins ``a1`` to ``b1``; a double slip joins ``a2`` to ``b2`` as
#: well, and is declared ``node X slip double yes``.
SLIP_PORTS = CROSSING_PORTS


@dataclass(frozen=True)
class EndRef:
    """One end of an edge, optionally naming a port on a multi ended node."""

    node: str
    port: str | None = None

    def __str__(self) -> str:
        return f"{self.node}.{self.port}" if self.port else self.node


@dataclass
class NodeDecl:
    name: str
    kind: NodeKind
    line: int = 0
    attributes: dict[str, str] = field(default_factory=dict)


@dataclass
class EdgeDecl:
    name: str
    start: EndRef
    end: EndRef
    length_metres: float
    line: int = 0
    speed_mph: float | None = None
    gradient: str | None = None
    attributes: dict[str, str] = field(default_factory=dict)


@dataclass
class SectionDecl:
    name: str
    edges: list[str]
    kind: SectionKind = SectionKind.TRACK_CIRCUIT
    line: int = 0


@dataclass
class SignalDecl:
    name: str
    edge: str
    offset_metres: float
    facing: Facing
    aspects: int = 3
    line: int = 0
    attributes: dict[str, str] = field(default_factory=dict)


class CrossingKind(Enum):
    """The kinds of level crossing a scheme may have.

    They differ in who is responsible for the road being clear, which is what
    decides whether a route over the crossing has to prove anything before it
    can be set.
    """

    MANUAL_BARRIER = "mcb"
    OBSTACLE_DETECTED = "mcb_od"
    AUTOMATIC_HALF = "ahb"
    USER_WORKED = "uwc"
    OPEN = "open"

    @property
    def is_protected(self) -> bool:
        """Whether the interlocking proves the crossing before clearing a signal."""
        return self in (CrossingKind.MANUAL_BARRIER, CrossingKind.OBSTACLE_DETECTED)

    @classmethod
    def from_word(cls, word: str) -> CrossingKind | None:
        for member in cls:
            if member.value == word:
                return member
        return None


@dataclass
class CrossingDecl:
    name: str
    edge: str
    offset_metres: float
    kind: CrossingKind = CrossingKind.MANUAL_BARRIER
    line: int = 0
    attributes: dict[str, str] = field(default_factory=dict)


@dataclass
class TrapDecl:
    """A derailer or set of trap points, which throws a runaway off the track."""

    name: str
    edge: str
    offset_metres: float
    facing: Facing = Facing.FORWARD
    line: int = 0
    attributes: dict[str, str] = field(default_factory=dict)


@dataclass
class SchemeDecl:
    """Everything a plan file declares, in the order it was written."""

    name: str = "unnamed"
    area: str | None = None
    prefix: str | None = None
    source: str = "<string>"
    nodes: list[NodeDecl] = field(default_factory=list)
    edges: list[EdgeDecl] = field(default_factory=list)
    sections: list[SectionDecl] = field(default_factory=list)
    signals: list[SignalDecl] = field(default_factory=list)
    crossings: list[CrossingDecl] = field(default_factory=list)
    traps: list[TrapDecl] = field(default_factory=list)
    includes: list[str] = field(default_factory=list)
    standards: dict[str, float] = field(default_factory=dict)

    def node(self, name: str) -> NodeDecl | None:
        for decl in self.nodes:
            if decl.name == name:
                return decl
        return None

    def edge(self, name: str) -> EdgeDecl | None:
        for decl in self.edges:
            if decl.name == name:
                return decl
        return None

    def signal(self, name: str) -> SignalDecl | None:
        for decl in self.signals:
            if decl.name == name:
                return decl
        return None

    def crossing(self, name: str) -> CrossingDecl | None:
        for decl in self.crossings:
            if decl.name == name:
                return decl
        return None

    def trap(self, name: str) -> TrapDecl | None:
        for decl in self.traps:
            if decl.name == name:
                return decl
        return None

    def merge(self, other: SchemeDecl) -> None:
        """Take everything another plan declares into this one.

        The header is only taken where this plan does not have one of its own,
        so an area file can be included by a scheme file without losing the
        scheme's name.
        """
        if self.area is None:
            self.area = other.area
        if self.prefix is None:
            self.prefix = other.prefix
        self.nodes.extend(other.nodes)
        self.edges.extend(other.edges)
        self.sections.extend(other.sections)
        self.signals.extend(other.signals)
        self.crossings.extend(other.crossings)
        self.traps.extend(other.traps)
        for name, value in other.standards.items():
            self.standards.setdefault(name, value)

    def summary(self) -> str:
        return (
            f"{self.name}: {len(self.nodes)} nodes, {len(self.edges)} edges, "
            f"{len(self.sections)} sections, {len(self.signals)} signals"
        )


#: Traffic directions as a signal engineer names them. These are labels only;
#: the geometry comes from :class:`Facing`.
TRAFFIC_DIRECTIONS = ("up", "down", "bidirectional")
