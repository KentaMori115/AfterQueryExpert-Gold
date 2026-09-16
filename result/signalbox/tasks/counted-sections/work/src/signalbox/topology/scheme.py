"""The whole scheme, assembled and ready to be interrogated.

A :class:`Scheme` is what every later stage works from. It owns the graph, the
section map and the signals, and it knows how to turn a plan's declarations into
all three.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..errors import InterlockingError
from ..layout.ast import CrossingDecl, Facing, NodeKind, SchemeDecl, SignalDecl
from ..layout.loader import load_path, load_text
from ..signalling.crossing import DEFAULT_STRIKE_IN, Crossing
from ..signalling.points import PointsMachine, machine_from
from ..signalling.signal import Signal, SignalType
from ..signalling.trap import Trap, trap_from
from ..standards import Standards
from ..units import Distance
from .graph import Sense, TrackGraph, build_graph
from .position import Position
from .section import SectionMap, build_sections

_SENSE_OF_FACING = {
    Facing.FORWARD: Sense.NOMINAL,
    Facing.BACKWARD: Sense.REVERSE,
}

_TYPE_WORDS = {
    "main": SignalType.MAIN,
    "shunt": SignalType.SHUNT,
    "banner": SignalType.BANNER_REPEATER,
}

_TRUTHY = {"yes", "true", "1"}


@dataclass
class Scheme:
    """A layout, its detection and its signals."""

    name: str
    graph: TrackGraph
    sections: SectionMap
    signals: dict[str, Signal] = field(default_factory=dict)
    crossings: dict[str, Crossing] = field(default_factory=dict)
    machines: dict[str, PointsMachine] = field(default_factory=dict)
    traps: dict[str, Trap] = field(default_factory=dict)
    mileages: dict[str, Distance] = field(default_factory=dict)
    standards: Standards = field(default_factory=Standards)
    _by_edge: dict[str, list[Signal]] | None = field(default=None, repr=False, compare=False)
    area: str | None = None
    prefix: str | None = None

    def signal(self, name: str) -> Signal:
        try:
            return self.signals[name]
        except KeyError:
            raise InterlockingError(f"no signal called {name}") from None

    def trap(self, name: str) -> Trap:
        try:
            return self.traps[name]
        except KeyError:
            raise InterlockingError(f"no trap called {name}") from None

    def machine(self, name: str) -> PointsMachine:
        try:
            return self.machines[name]
        except KeyError:
            raise InterlockingError(f"no points called {name}") from None

    def crossing(self, name: str) -> Crossing:
        try:
            return self.crossings[name]
        except KeyError:
            raise InterlockingError(f"no crossing called {name}") from None

    def crossings_on(self, edge: str) -> list[Crossing]:
        found = [c for c in self.crossings.values() if c.position.edge == edge]
        return sorted(found, key=lambda c: c.position.offset.metres)

    def signals_on(self, edge: str) -> list[Signal]:
        """Signals standing on an edge, in the order they appear along it.

        This is asked once per edge for every step of every walk over the graph,
        so the answer is worked out once and kept. The index is dropped whenever
        a signal is added, which only happens while a scheme is being built.
        """
        if self._by_edge is None:
            index: dict[str, list[Signal]] = {}
            for signal in self.signals.values():
                index.setdefault(signal.position.edge, []).append(signal)
            for found in index.values():
                found.sort(key=lambda s: s.position.offset.metres)
            self._by_edge = index
        return list(self._by_edge.get(edge, ()))

    def forget_index(self) -> None:
        """Throw the signal index away, after changing the signals."""
        self._by_edge = None

    def running_signals(self) -> list[Signal]:
        return [s for s in self.sorted_signals() if s.type.carries_main_routes]

    def shunt_signals(self) -> list[Signal]:
        return [s for s in self.sorted_signals() if s.type is SignalType.SHUNT]

    def sorted_signals(self) -> list[Signal]:
        return [self.signals[name] for name in sorted(self.signals)]

    def direction_of(self, signal_name: str) -> str | None:
        return self.signal(signal_name).attributes.get("direction")

    def describe(self) -> str:
        return (
            f"{self.area or self.name}: {len(self.graph.nodes)} nodes, "
            f"{len(self.graph)} edges, {len(self.sections)} sections, "
            f"{len(self.signals)} signals"
        )


def _signal_from(decl: SignalDecl) -> Signal:
    attributes = dict(decl.attributes)
    word = attributes.pop("type", "main")
    kind = _TYPE_WORDS.get(word)
    if kind is None:
        raise InterlockingError(f"signal {decl.name} has unknown type {word!r}")
    subsidiary = attributes.pop("subsidiary", "no").lower() in _TRUTHY
    automatic = attributes.pop("automatic", "no").lower() in _TRUTHY
    return Signal(
        name=decl.name,
        position=Position(
            decl.edge, Distance(decl.offset_metres), _SENSE_OF_FACING[decl.facing]
        ),
        heads=decl.aspects,
        type=kind,
        subsidiary=subsidiary,
        automatic=automatic,
        attributes=attributes,
    )


def _crossing_from(decl: CrossingDecl) -> Crossing:
    attributes = dict(decl.attributes)
    strike_in = float(attributes.pop("strike_in", DEFAULT_STRIKE_IN))
    return Crossing(
        name=decl.name,
        position=Position(decl.edge, Distance(decl.offset_metres)),
        kind=decl.kind,
        strike_in=strike_in,
        attributes=attributes,
    )


def build_scheme(decl: SchemeDecl) -> Scheme:
    """Assemble graph, sections, signals and crossings from validated declarations."""
    signals = {}
    for signal_decl in decl.signals:
        signals[signal_decl.name] = _signal_from(signal_decl)
    crossings = {c.name: _crossing_from(c) for c in decl.crossings}
    traps = {t.name: trap_from(t) for t in decl.traps}
    mileages = {}
    for edge in decl.edges:
        written = edge.attributes.get("mileage")
        if written is not None:
            mileages[edge.start.node] = Distance.parse(written)
    machines = {
        node.name: machine_from(node)
        for node in decl.nodes
        if node.kind in (NodeKind.POINTS, NodeKind.SLIP)
    }
    return Scheme(
        name=decl.name,
        graph=build_graph(decl),
        sections=build_sections(decl),
        signals=signals,
        crossings=crossings,
        machines=machines,
        traps=traps,
        mileages=mileages,
        standards=Standards.from_settings(decl.standards),
        area=decl.area,
        prefix=decl.prefix,
    )


def scheme_from_text(text: str, *, source: str = "<string>") -> Scheme:
    return build_scheme(load_text(text, source=source))


def scheme_from_path(path: str) -> Scheme:
    return build_scheme(load_path(path))
