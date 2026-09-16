"""The track as a graph of edges joined at nodes.

An edge is a piece of plain line with a length. A node is whatever joins edges
together: a boundary where the scheme ends, a buffer stop, a set of points, or a
diamond crossing. Points are the interesting case, because which edges are
connected depends on how the blades are lying.

Edges have a sense. ``Sense.NOMINAL`` runs from the edge's declared start to its
declared end; ``Sense.REVERSE`` runs the other way. Everything that walks the
graph carries a sense with it so that a train knows which way it is pointing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from ..errors import TopologyError
from ..layout.ast import (
    CROSSING_PORTS,
    POINT_PORTS,
    SLIP_PORTS,
    EndRef,
    NodeKind,
    SchemeDecl,
)
from ..units import Distance, Gradient, Speed


class Sense(Enum):
    """Which way along an edge something is pointing."""

    NOMINAL = 1
    REVERSE = -1

    @property
    def opposite(self) -> Sense:
        return Sense.REVERSE if self is Sense.NOMINAL else Sense.NOMINAL


#: Plans are drawn with every edge running in the direction of down traffic, so
#: the nominal sense of an edge is the down direction and the reverse sense is
#: the up direction. Nothing else in the package assumes which way round the
#: compass the layout is.
DOWN_SENSE = Sense.NOMINAL
UP_SENSE = Sense.REVERSE

_SENSES_WORKED = {
    "down": (Sense.NOMINAL,),
    "up": (Sense.REVERSE,),
    "bidirectional": (Sense.NOMINAL, Sense.REVERSE),
}


class Lie(Enum):
    """How a set of points is lying."""

    NORMAL = "normal"
    REVERSE = "reverse"

    @property
    def port(self) -> str:
        return self.value

    @property
    def opposite(self) -> Lie:
        return Lie.REVERSE if self is Lie.NORMAL else Lie.NORMAL


@dataclass(frozen=True)
class Port:
    """A named end of a node, or the only end of a simple one."""

    node: str
    name: str | None = None

    def __str__(self) -> str:
        return f"{self.node}.{self.name}" if self.name else self.node


#: The two roads of a crossing or a slip, straight through.
STRAIGHT = {"a1": "a2", "a2": "a1", "b1": "b2", "b2": "b1"}

#: What a slip joins when it lies reverse. A double slip has both pairs.
SLIPPED = {"a1": "b1", "b1": "a1"}
SLIPPED_DOUBLE = {**SLIPPED, "a2": "b2", "b2": "a2"}


@dataclass
class Node:
    name: str
    kind: NodeKind
    ports: dict[str | None, str] = field(default_factory=dict)
    double: bool = False

    @property
    def is_points(self) -> bool:
        return self.kind is NodeKind.POINTS

    @property
    def is_slip(self) -> bool:
        return self.kind is NodeKind.SLIP

    @property
    def can_be_moved(self) -> bool:
        """Whether the interlocking has to call this node one way or the other."""
        return self.is_points or self.is_slip

    @property
    def is_terminal(self) -> bool:
        return self.kind in (NodeKind.BUFFER, NodeKind.BOUNDARY)

    def edge_at(self, port: str | None) -> str:
        try:
            return self.ports[port]
        except KeyError:
            raise TopologyError(f"node {self.name} has nothing at port {port!r}") from None


@dataclass
class Edge:
    name: str
    start: Port
    end: Port
    length: Distance
    speed: Speed | None = None
    gradient: Gradient = field(default_factory=Gradient.level)
    direction: str = "bidirectional"

    @property
    def senses_worked(self) -> tuple[Sense, ...]:
        return _SENSES_WORKED[self.direction]

    def permits(self, sense: Sense) -> bool:
        """Whether trains are signalled over this edge in ``sense``."""
        return sense in self.senses_worked

    @property
    def is_bidirectional(self) -> bool:
        return len(self.senses_worked) == 2

    def port_for(self, sense: Sense) -> Port:
        """The end an object travelling in ``sense`` is heading towards."""
        return self.end if sense is Sense.NOMINAL else self.start

    def entry_port(self, sense: Sense) -> Port:
        return self.start if sense is Sense.NOMINAL else self.end

    def sense_leaving(self, port: Port) -> Sense:
        """The sense of travel for something entering this edge at ``port``."""
        if port == self.start:
            return Sense.NOMINAL
        if port == self.end:
            return Sense.REVERSE
        raise TopologyError(f"edge {self.name} does not touch {port}")

    def other_port(self, port: Port) -> Port:
        if port == self.start:
            return self.end
        if port == self.end:
            return self.start
        raise TopologyError(f"edge {self.name} does not touch {port}")


class TrackGraph:
    """Nodes and edges with the connectivity rules for each kind of node."""

    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: dict[str, Edge] = {}

    # construction ------------------------------------------------------

    def add_node(self, node: Node) -> None:
        if node.name in self.nodes:
            raise TopologyError(f"node {node.name} added twice")
        self.nodes[node.name] = node

    def add_edge(self, edge: Edge) -> None:
        if edge.name in self.edges:
            raise TopologyError(f"edge {edge.name} added twice")
        for port in (edge.start, edge.end):
            node = self.nodes.get(port.node)
            if node is None:
                raise TopologyError(f"edge {edge.name} joins unknown node {port.node}")
            node.ports[port.name] = edge.name
        self.edges[edge.name] = edge

    # lookup ------------------------------------------------------------

    def node(self, name: str) -> Node:
        try:
            return self.nodes[name]
        except KeyError:
            raise TopologyError(f"no node called {name}") from None

    def edge(self, name: str) -> Edge:
        try:
            return self.edges[name]
        except KeyError:
            raise TopologyError(f"no edge called {name}") from None

    # connectivity ------------------------------------------------------

    def ports_connected_at(
        self, node_name: str, arriving_at: str | None, lie: Lie
    ) -> list[str | None]:
        """Which ports of a node are joined to ``arriving_at`` when it lies ``lie``."""
        node = self.node(node_name)
        if node.kind in (NodeKind.BUFFER, NodeKind.BOUNDARY):
            return []
        if node.kind is NodeKind.PLAIN:
            return [port for port in node.ports if port != arriving_at]
        if node.kind is NodeKind.POINTS:
            if arriving_at == "toe":
                return [lie.port]
            if arriving_at == lie.port:
                return ["toe"]
            return []
        if node.kind is NodeKind.CROSSING:
            other = STRAIGHT.get(arriving_at or "")
            return [other] if other else []
        if node.kind is NodeKind.SLIP:
            if lie is Lie.NORMAL:
                straight = STRAIGHT.get(arriving_at or "")
                return [straight] if straight else []
            joined = SLIPPED_DOUBLE if node.double else SLIPPED
            slipped = joined.get(arriving_at or "")
            return [slipped] if slipped else []
        raise TopologyError(f"do not know how to traverse a {node.kind.value}")

    def step(
        self, edge_name: str, sense: Sense, lie: Lie = Lie.NORMAL
    ) -> list[tuple[str, Sense]]:
        """Every edge reachable by running off the far end of ``edge_name``."""
        edge = self.edge(edge_name)
        port = edge.port_for(sense)
        onward: list[tuple[str, Sense]] = []
        for next_port_name in self.ports_connected_at(port.node, port.name, lie):
            next_edge_name = self.node(port.node).edge_at(next_port_name)
            next_edge = self.edge(next_edge_name)
            entry = Port(port.node, next_port_name)
            onward.append((next_edge_name, next_edge.sense_leaving(entry)))
        return onward

    def points(self) -> list[str]:
        return sorted(name for name, node in self.nodes.items() if node.is_points)

    def slips(self) -> list[str]:
        return sorted(name for name, node in self.nodes.items() if node.is_slip)

    def movable(self) -> list[str]:
        """Everything the interlocking has to call one way or the other."""
        return sorted(name for name, node in self.nodes.items() if node.can_be_moved)

    def __len__(self) -> int:
        return len(self.edges)

    def __repr__(self) -> str:
        return f"<TrackGraph {len(self.nodes)} nodes {len(self.edges)} edges>"


class _PortAllocator:
    """Hands out slot names for the unnamed ends of plain joins.

    A plain node has two ends and neither is worth a name in the plan, so the
    graph names them ``1`` and ``2`` in the order the edges were declared.
    """

    def __init__(self, scheme: SchemeDecl) -> None:
        self.kinds = {node.name: node.kind for node in scheme.nodes}
        self.issued: dict[str, int] = {}

    def resolve(self, ref: EndRef) -> Port:
        if ref.port is not None:
            return Port(ref.node, ref.port)
        if self.kinds.get(ref.node) is not NodeKind.PLAIN:
            return Port(ref.node, None)
        count = self.issued.get(ref.node, 0) + 1
        self.issued[ref.node] = count
        return Port(ref.node, str(count))


def build_graph(scheme: SchemeDecl) -> TrackGraph:
    """Turn validated declarations into a graph."""
    graph = TrackGraph()
    allocator = _PortAllocator(scheme)
    for decl in scheme.nodes:
        double = decl.attributes.get("double", "no").lower() in {"yes", "true", "1"}
        graph.add_node(Node(decl.name, decl.kind, double=double))
    for edge_decl in scheme.edges:
        speed = edge_decl.speed_mph
        graph.add_edge(
            Edge(
                name=edge_decl.name,
                start=allocator.resolve(edge_decl.start),
                end=allocator.resolve(edge_decl.end),
                length=Distance(edge_decl.length_metres),
                speed=Speed.from_mph(speed) if speed is not None else None,
                gradient=(
                    Gradient.parse(edge_decl.gradient)
                    if edge_decl.gradient
                    else Gradient.level()
                ),
                direction=edge_decl.attributes.get("direction", "bidirectional"),
            )
        )
    _check_ports_complete(graph)
    return graph


def _check_ports_complete(graph: TrackGraph) -> None:
    for node in graph.nodes.values():
        if node.kind is NodeKind.POINTS:
            missing = [p for p in POINT_PORTS if p not in node.ports]
        elif node.kind is NodeKind.CROSSING:
            missing = [p for p in CROSSING_PORTS if p not in node.ports]
        elif node.kind is NodeKind.SLIP:
            missing = [p for p in SLIP_PORTS if p not in node.ports]
        elif node.kind is NodeKind.PLAIN:
            missing = [p for p in ("1", "2") if p not in node.ports]
        else:
            missing = []
        if missing:
            raise TopologyError(f"node {node.name} is missing {', '.join(missing)}")
