"""Walking the graph, branching wherever the points can send you two ways.

Route finding, overlap selection and flank protection all reduce to the same
question: starting here and facing this way, where can I get to and what do the
points have to be doing for me to get there. That is what a :class:`Path` is.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field

from ..units import Distance
from .graph import Lie, Sense, TrackGraph
from .position import Position

#: Called with the position at the far end of an edge just reached. Returning
#: True ends the path there without exploring further.
StopRule = Callable[["Path", Position], bool]


@dataclass(frozen=True)
class Path:
    """A run of edges, in order, with the point settings it depends on."""

    start: Position
    steps: tuple[tuple[str, Sense], ...] = ()
    lies: Mapping[str, Lie] = field(default_factory=dict)
    length: Distance = Distance(0.0)

    @property
    def edges(self) -> tuple[str, ...]:
        return tuple(edge for edge, _ in self.steps)

    @property
    def is_empty(self) -> bool:
        return not self.steps

    def end(self, graph: TrackGraph) -> Position:
        """Where the path finishes, facing the way it was travelling."""
        if not self.steps:
            return self.start
        edge_name, sense = self.steps[-1]
        edge = graph.edge(edge_name)
        offset = edge.length if sense is Sense.NOMINAL else Distance(0.0)
        return Position(edge_name, offset, sense)

    def extend(self, edge: str, sense: Sense, added: Distance, lies: Mapping[str, Lie]) -> Path:
        merged = dict(self.lies)
        merged.update(lies)
        return Path(
            start=self.start,
            steps=(*self.steps, (edge, sense)),
            lies=merged,
            length=Distance(self.length.metres + added.metres),
        )

    def uses(self, edge: str) -> bool:
        return any(name == edge for name, _ in self.steps)

    def conflicts_with(self, other: Path) -> bool:
        """True if the two paths need the same points lying different ways."""
        return any(
            node in other.lies and other.lies[node] is not lie
            for node, lie in self.lies.items()
        )

    def __str__(self) -> str:
        arrow = " ".join(
            f"{edge}{'+' if sense is Sense.NOMINAL else '-'}" for edge, sense in self.steps
        )
        return arrow or "(here)"


def explore(
    graph: TrackGraph,
    start: Position,
    *,
    limit: Distance | None = None,
    stop: StopRule | None = None,
) -> Iterator[Path]:
    """Yield every distinct path leading forward from ``start``.

    The first step is always the edge ``start`` sits on, and the length is
    measured from ``start``, not from that edge's beginning. A path ends when the
    stop rule says so, when the track runs out, when the limit is passed, or when
    it would revisit an edge it has already used. The stop rule is only asked
    about edges the walk moves onto, never about the starting edge.
    """
    ceiling = limit.metres if limit is not None else float("inf")
    root = Path(
        start=start,
        steps=((start.edge, start.sense),),
        length=start.remaining(graph),
    )
    stack: list[Path] = [root]

    while stack:
        path = stack.pop()
        grew = False
        for edge_name, sense, lies in _onward(graph, path, path.end(graph)):
            if path.uses(edge_name):
                continue
            extended = path.extend(edge_name, sense, graph.edge(edge_name).length, lies)
            if extended.length.metres > ceiling:
                continue
            grew = True
            if stop is not None and stop(extended, extended.end(graph)):
                yield extended
            else:
                stack.append(extended)
        if not grew:
            yield path


def _onward(
    graph: TrackGraph, path: Path, here: Position
) -> list[tuple[str, Sense, dict[str, Lie]]]:
    """Every edge reachable from ``here``, with the points it would need."""
    edge = graph.edge(here.edge)
    port = edge.port_for(here.sense)
    node = graph.node(port.node)
    results: list[tuple[str, Sense, dict[str, Lie]]] = []

    candidate_lies = [Lie.NORMAL, Lie.REVERSE] if node.can_be_moved else [Lie.NORMAL]
    for lie in candidate_lies:
        already = path.lies.get(port.node)
        if node.can_be_moved and already is not None and already is not lie:
            continue
        for next_edge, next_sense in graph.step(here.edge, here.sense, lie):
            needed = {port.node: lie} if node.can_be_moved else {}
            results.append((next_edge, next_sense, needed))
    return results
