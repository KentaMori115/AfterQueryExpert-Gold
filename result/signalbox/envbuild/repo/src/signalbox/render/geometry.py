"""Working out where to put things on a schematic.

Signalling diagrams are drawn as straight lines with the diverging road stepped
away from the main one. That is what this does: walk the graph from a datum,
carry the distance along as an x coordinate, and drop a row every time the walk
goes out through the reverse leg of a set of points.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from ..topology.graph import Port, Sense, TrackGraph
from ..topology.position import Position
from ..topology.scheme import Scheme

#: Metres to schematic units. A kilometre comes out as fifty units.
DEFAULT_SCALE = 0.05

#: How far apart two roads are drawn.
DEFAULT_SPACING = 40.0

#: Short edges would otherwise vanish, so nothing is drawn shorter than this.
MINIMUM_RUN = 12.0


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def moved(self, dx: float = 0.0, dy: float = 0.0) -> Point:
        return Point(self.x + dx, self.y + dy)

    def __str__(self) -> str:
        return f"({self.x:.1f}, {self.y:.1f})"


@dataclass
class Placement:
    """Where every node and edge sits on the diagram."""

    nodes: dict[str, Point] = field(default_factory=dict)
    edges: dict[str, tuple[Point, Point]] = field(default_factory=dict)
    scale: float = DEFAULT_SCALE

    @property
    def is_empty(self) -> bool:
        return not self.nodes

    def bounds(self) -> tuple[float, float, float, float]:
        """Left, top, right, bottom of everything placed."""
        if not self.nodes:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [point.x for point in self.nodes.values()]
        ys = [point.y for point in self.nodes.values()]
        return (min(xs), min(ys), max(xs), max(ys))

    def size(self) -> tuple[float, float]:
        left, top, right, bottom = self.bounds()
        return (right - left, bottom - top)

    def at(self, node: str) -> Point:
        return self.nodes[node]

    def along(self, position: Position, graph: TrackGraph) -> Point:
        """Where a position along an edge falls on the diagram."""
        start, end = self.edges[position.edge]
        length = graph.edge(position.edge).length.metres
        fraction = 0.0 if length == 0 else min(max(position.offset.metres / length, 0.0), 1.0)
        return Point(
            start.x + (end.x - start.x) * fraction,
            start.y + (end.y - start.y) * fraction,
        )


def _run_length(metres: float, scale: float) -> float:
    return max(metres * scale, MINIMUM_RUN)


def place(
    scheme: Scheme,
    *,
    scale: float = DEFAULT_SCALE,
    spacing: float = DEFAULT_SPACING,
    datum: str | None = None,
) -> Placement:
    """Lay the whole scheme out from a datum node."""
    graph = scheme.graph
    placement = Placement(scale=scale)
    if not graph.nodes:
        return placement

    starts = [datum] if datum else _datums(graph)
    row = 0.0

    for start in starts:
        if start in placement.nodes:
            continue
        placement.nodes[start] = Point(0.0, row)
        _walk_from(graph, placement, start, spacing, scale)
        row = placement.bounds()[3] + spacing * 2

    return placement


def _datums(graph: TrackGraph) -> list[str]:
    """Boundaries first, then anything else, so a line starts at its edge."""
    boundaries = sorted(
        name for name, node in graph.nodes.items() if node.kind.value == "boundary"
    )
    others = sorted(name for name in graph.nodes if name not in boundaries)
    return boundaries + others


def _walk_from(
    graph: TrackGraph, placement: Placement, start: str, spacing: float, scale: float
) -> None:
    queue: deque[str] = deque([start])
    while queue:
        name = queue.popleft()
        here = placement.nodes[name]
        node = graph.node(name)
        for port, edge_name in sorted(node.ports.items(), key=lambda item: str(item[0])):
            edge = graph.edge(edge_name)
            far = edge.other_port(_port_of(name, port))
            if edge_name in placement.edges:
                continue
            run = _run_length(edge.length.metres, scale)
            leaving = edge.sense_leaving(_port_of(name, port))
            direction = 1.0 if leaving is Sense.NOMINAL else -1.0
            drop = spacing if port == "reverse" else 0.0
            target = placement.nodes.get(far.node)
            if target is None:
                target = here.moved(run * direction, drop)
                placement.nodes[far.node] = target
                queue.append(far.node)
            placement.edges[edge_name] = (here, target) if direction > 0 else (target, here)


def _port_of(node: str, port: str | None) -> Port:
    return Port(node, port)
