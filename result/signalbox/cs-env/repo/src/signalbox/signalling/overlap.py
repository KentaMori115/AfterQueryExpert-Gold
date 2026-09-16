"""Overlaps: the track beyond the exit signal that has to be clear anyway.

A driver who passes the signal at the end of a route is expected to stop before
the next one, but the interlocking does not rely on that. It holds a length of
track beyond the exit signal clear and its points locked, so that a train that
overruns has somewhere to go. Where the points beyond a signal can offer more
than one such length, the overlap swings: the interlocking picks whichever one
it can get, preferring the one that gets in the way of least.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from ..topology.graph import Lie, Sense
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance
from .route import Route, RouteClass

#: An overlap is stored the same way a path is, as edges with the sense the
#: train would be running through them.
Steps = tuple[tuple[str, Sense], ...]

#: The overlap length a scheme uses when nothing else is said. Two hundred yards
#: is the figure most British schemes are drawn to.
STANDARD_OVERLAP = Distance(183.0)

#: Below this speed an overlap may be shortened, which is what makes platform
#: starting signals workable in a station throat.
REDUCED_OVERLAP = Distance(46.0)


@dataclass(frozen=True)
class Overlap:
    """One length of track held beyond the exit signal of a route."""

    route: str
    steps: tuple[tuple[str, Sense], ...]
    sections: tuple[str, ...]
    points: Mapping[str, Lie] = field(default_factory=dict)
    length: Distance = Distance(0.0)
    suffix: str = ""
    full: bool = True

    @property
    def edges(self) -> tuple[str, ...]:
        return tuple(edge for edge, _ in self.steps)

    @property
    def name(self) -> str:
        return f"{self.route}{self.suffix}" if self.suffix else self.route

    @property
    def swings(self) -> bool:
        return bool(self.suffix)

    def __str__(self) -> str:
        track = " ".join(self.sections) or "none"
        return f"{self.name}: {track} ({self.length.metres:.0f}m)"


#: How long a train has to have been standing at the signal before the overlap
#: beyond it is given up, in seconds. Two minutes is the usual figure.
OVERLAP_RELEASE_DELAY = 120.0


def release_delay(overlap: Overlap, *, standard: Distance = STANDARD_OVERLAP) -> float:
    """Seconds before a stood train's overlap may be released.

    An overlap that was never full length has nothing to give up gradually, so
    it is released as soon as the train is at a stand.
    """
    if not overlap.full or overlap.length.metres < standard.metres:
        return 0.0
    return OVERLAP_RELEASE_DELAY


def shortest(overlaps: list[Overlap]) -> Overlap | None:
    """The overlap that gets in the way of least, used when the longest is held."""
    if not overlaps:
        return None
    return min(overlaps, key=lambda o: o.length.metres)


def holds_section(overlaps: list[Overlap], section: str) -> bool:
    return any(section in overlap.sections for overlap in overlaps)


def overlap_needed(route: Route) -> bool:
    """Whether this class of route is given an overlap at all.

    Shunt and call on moves are made at a speed the driver can stop from, so
    they are not given one. Neither is a route that ends at a buffer stop or at
    the edge of the scheme, because there is nothing beyond it to hold.
    """
    if route.klass is RouteClass.WARNING:
        # The whole point of a warning route is that it does without one.
        return False
    if not route.klass.clears_signal:
        return False
    return route.exit.is_signal


def overlaps_for(
    scheme: Scheme,
    route: Route,
    *,
    standard: Distance = STANDARD_OVERLAP,
) -> list[Overlap]:
    """Every overlap the interlocking could hold beyond ``route``.

    More than one means the overlap swings. They come back longest first, and
    lettered A, B, C in that order.
    """
    if not overlap_needed(route):
        return []

    signal = scheme.signal(route.exit.name)
    found: list[tuple[Steps, dict[str, Lie], float, bool]] = []
    _walk(scheme, signal.position, standard.metres, (), {}, found)

    found.sort(key=lambda item: (-item[2], item[0]))
    overlaps: list[Overlap] = []
    for offset, (steps, lies, length, full) in enumerate(found):
        sections = _sections_over(scheme, tuple(edge for edge, _ in steps))
        overlaps.append(
            Overlap(
                route=route.name,
                steps=steps,
                sections=sections,
                points=lies,
                length=Distance(length),
                suffix=chr(ord("A") + offset) if len(found) > 1 else "",
                full=full,
            )
        )
    return overlaps


def _sections_over(scheme: Scheme, edges: tuple[str, ...]) -> tuple[str, ...]:
    ordered: list[str] = []
    for edge in edges:
        name = scheme.sections.name_for(edge)
        if name is not None and (not ordered or ordered[-1] != name):
            ordered.append(name)
    return tuple(ordered)


def _walk(
    scheme: Scheme,
    start: Position,
    wanted: float,
    steps: Steps,
    lies: dict[str, Lie],
    out: list[tuple[Steps, dict[str, Lie], float, bool]],
    travelled: float = 0.0,
) -> None:
    """Depth first search forward from the exit signal for ``wanted`` metres."""
    graph = scheme.graph
    here = start
    covered = travelled + here.remaining(graph).metres
    walked = tuple(edge for edge, _ in steps)
    if here.edge in walked or (not steps and here.remaining(graph).metres == 0):
        reached = steps
    else:
        reached = (*steps, (here.edge, here.sense))

    if covered >= wanted:
        out.append((reached, dict(lies), wanted, True))
        return

    port = graph.edge(here.edge).port_for(here.sense)
    node = graph.node(port.node)
    options = [Lie.NORMAL, Lie.REVERSE] if node.can_be_moved else [Lie.NORMAL]
    grew = False
    for lie in options:
        if node.can_be_moved and lies.get(port.node) not in (None, lie):
            continue
        for next_edge, next_sense in graph.step(here.edge, here.sense, lie):
            if next_edge in {edge for edge, _ in reached}:
                continue
            edge = graph.edge(next_edge)
            if not edge.permits(next_sense):
                continue
            onward = dict(lies)
            if node.can_be_moved:
                onward[port.node] = lie
            offset = Distance(0.0) if next_sense is Sense.NOMINAL else edge.length
            grew = True
            _walk(
                scheme,
                Position(next_edge, offset, next_sense),
                wanted,
                reached,
                onward,
                out,
                covered,
            )
    if not grew:
        out.append((reached, dict(lies), covered, False))


def swinging(overlaps: list[Overlap]) -> bool:
    return len(overlaps) > 1


def preferred(overlaps: list[Overlap]) -> Overlap | None:
    """The overlap the interlocking takes first, which is the longest one."""
    return overlaps[0] if overlaps else None
