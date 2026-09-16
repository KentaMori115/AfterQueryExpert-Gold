"""Flank protection: keeping other movements out of the side of a set route.

The points a route runs over are locked by the route itself. What is left is
everything that could arrive from the side. At every node the route passes
through there are ends the route does not use, and something on the far side of
each of them has to be stopping a movement from coming down it.

Walking back from that end, the first thing found decides the protection:

* a set of points reached at one of its legs can be laid the other way, so they
  are called for as flank points;
* a trap or derailer facing the movement throws it off before it arrives;
* a signal facing towards the route has to be held at danger;
* a buffer stop or a set of trap points means there is nothing to protect
  against;
* finding nothing inside the search distance is an unprotected flank, which the
  rule engine reports rather than the designer discovering it on site.

The search deliberately ignores the direction a track is worked in. A runaway
does not care which way the arrows on the plan point, and neither does a
shunter who has forgotten where he is.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from itertools import pairwise

from ..layout.ast import NodeKind
from ..topology.graph import Lie, Sense, TrackGraph
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..topology.traverse import entry_position, walk
from ..units import Distance
from .route import Route

#: How far back to look for something that protects a flank.
FLANK_SEARCH = Distance(400.0)


class FlankKind(Enum):
    POINTS = "points"
    TRAP = "trap"
    SIGNAL = "signal"
    DEAD_END = "dead end"
    UNPROTECTED = "unprotected"

    @property
    def is_protection(self) -> bool:
        return self is not FlankKind.UNPROTECTED


@dataclass(frozen=True)
class Flank:
    """One way into the side of a route, and what keeps it shut."""

    route: str
    node: str
    port: str | None
    kind: FlankKind
    element: str | None = None
    lie: Lie | None = None
    distance: Distance = Distance(0.0)

    @property
    def protected(self) -> bool:
        return self.kind.is_protection

    def requirement(self) -> str:
        if self.kind is FlankKind.POINTS and self.lie is not None:
            return f"{self.element} {self.lie.value}"
        if self.kind is FlankKind.TRAP:
            return f"{self.element} trap"
        if self.kind is FlankKind.SIGNAL:
            return f"{self.element} at danger"
        if self.kind is FlankKind.DEAD_END:
            return "dead end"
        return "none"

    def __str__(self) -> str:
        where = f"{self.node}.{self.port}" if self.port else self.node
        return f"{self.route} flank at {where}: {self.requirement()}"


def nodes_on(
    graph: TrackGraph, edges: tuple[str, ...]
) -> list[tuple[str, str | None, str | None]]:
    """Nodes a run of edges passes through, with the two ports it uses there."""
    passed: list[tuple[str, str | None, str | None]] = []
    for first, second in pairwise(edges):
        one, two = graph.edge(first), graph.edge(second)
        passed.extend(
            (port_a.node, port_a.name, port_b.name)
            for port_a in (one.start, one.end)
            for port_b in (two.start, two.end)
            if port_a.node == port_b.node
        )
    return passed


def flanks_for(
    scheme: Scheme,
    route: Route,
    *,
    overlap_edges: tuple[str, ...] = (),
    search: Distance = FLANK_SEARCH,
) -> list[Flank]:
    """Every flank the route has, protected or not."""
    graph = scheme.graph
    covered = route.covered_edges + tuple(
        e for e in overlap_edges if e not in route.covered_edges
    )
    found: list[Flank] = []

    for node_name, in_port, out_port in nodes_on(graph, covered):
        node = graph.node(node_name)
        used = {in_port, out_port}
        for port in node.ports:
            if port in used:
                continue
            found.append(_examine(scheme, route, node_name, port, search))
    return found


def _examine(
    scheme: Scheme, route: Route, node_name: str, port: str | None, search: Distance
) -> Flank:
    """Walk back from an unused end of a node until something protects it."""
    graph = scheme.graph
    edge_name = graph.node(node_name).edge_at(port)
    edge = graph.edge(edge_name)
    joint = next(p for p in (edge.start, edge.end) if p.node == node_name)
    away = Sense.NOMINAL if joint == edge.start else Sense.REVERSE
    start = entry_position(graph, edge_name, away)

    def found(kind: FlankKind, element: str | None, lie: Lie | None, at: float) -> Flank:
        return Flank(route.name, node_name, port, kind, element, lie, Distance(at))

    reached = 0.0
    for step in walk(graph, start, limit=search):
        reached = step.travelled.metres
        trap = _trap_facing_back(scheme, step.position)
        if trap is not None:
            return found(FlankKind.TRAP, trap, None, reached)
        signal = _signal_facing_back(scheme, step.position)
        if signal is not None:
            return found(FlankKind.SIGNAL, signal, None, reached)

        beyond = reached + step.remaining(graph).metres
        far = graph.edge(step.edge).port_for(step.sense)
        far_node = graph.node(far.node)

        if far_node.is_terminal:
            kind = (
                FlankKind.DEAD_END
                if far_node.kind is NodeKind.BUFFER
                else FlankKind.UNPROTECTED
            )
            return found(kind, far.node, None, beyond)

        if far_node.is_points and far.name in ("normal", "reverse"):
            away_lie = Lie.REVERSE if far.name == "normal" else Lie.NORMAL
            return found(FlankKind.POINTS, far.node, away_lie, beyond)

    return found(FlankKind.UNPROTECTED, None, None, min(reached, search.metres))


def _trap_facing_back(scheme: Scheme, here: Position) -> str | None:
    """A trap on this edge that would derail a movement coming towards the route."""
    hazard_sense = here.sense.opposite
    candidates = [
        trap
        for trap in scheme.traps.values()
        if trap.edge == here.edge
        and trap.catches(hazard_sense)
        and _is_ahead(here, trap.position)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda trap: abs(trap.position.offset.metres - here.offset.metres))
    return candidates[0].name


def _signal_facing_back(scheme: Scheme, here: Position) -> str | None:
    """A signal on this edge that would authorise a move towards the route."""
    hazard_sense = here.sense.opposite
    candidates = [
        s
        for s in scheme.signals_on(here.edge)
        if s.position.sense is hazard_sense and _is_ahead(here, s.position)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda s: abs(s.position.offset.metres - here.offset.metres))
    return candidates[0].name


def _is_ahead(here: Position, other: Position) -> bool:
    if here.sense is Sense.NOMINAL:
        return other.offset.metres >= here.offset.metres
    return other.offset.metres <= here.offset.metres


def unprotected(flanks: list[Flank]) -> list[Flank]:
    return [flank for flank in flanks if not flank.protected]
