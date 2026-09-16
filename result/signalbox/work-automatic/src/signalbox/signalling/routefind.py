"""Working out what routes a scheme has, by walking forward from every signal.

A route runs from one signal to the next signal facing the same way, over track
worked in the direction the route runs. Where the points can send a train two
ways there are two routes, and they get lettered
suffixes in the order their exit signals sort, so that regenerating the table
from an unchanged plan gives an unchanged answer.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..layout.ast import NodeKind
from ..topology.graph import Lie, Sense
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..topology.walk import Path
from ..units import Distance
from .route import EndKind, Route, RouteClass, RouteEnd
from .signal import Signal, SignalType

#: Nothing sensible is more than this far from the signal behind it, and the
#: limit stops a walk running away across a badly drawn plan.
DEFAULT_LIMIT = Distance(8000.0)


@dataclass(frozen=True)
class _Ahead:
    """A signal found in front of the walker, and how far away it was."""

    signal: Signal
    distance: Distance


class SignalIndex:
    """Signals grouped by the edge they stand on, for quick lookahead."""

    def __init__(self, scheme: Scheme) -> None:
        self._by_edge: dict[str, list[Signal]] = {}
        for signal in scheme.signals.values():
            self._by_edge.setdefault(signal.position.edge, []).append(signal)
        for signals in self._by_edge.values():
            signals.sort(key=lambda s: s.position.offset.metres)

    def next_on(self, edge: str, sense: Sense, after: Distance) -> Signal | None:
        """The first signal on ``edge`` beyond ``after``, facing ``sense``."""
        candidates = [s for s in self._by_edge.get(edge, []) if s.position.sense is sense]
        if sense is Sense.NOMINAL:
            ahead = [s for s in candidates if s.position.offset.metres > after.metres]
            return ahead[0] if ahead else None
        behind = [s for s in candidates if s.position.offset.metres < after.metres]
        return behind[-1] if behind else None


def _gap(start: Distance, end: Distance) -> float:
    """How far apart two offsets on the same edge are."""
    return abs(end.metres - start.metres)


def _class_for(entrance: Signal, exit_signal: Signal | None) -> RouteClass:
    if entrance.type is SignalType.SHUNT:
        return RouteClass.SHUNT
    if exit_signal is not None and exit_signal.type is SignalType.SHUNT:
        return RouteClass.SHUNT
    return RouteClass.MAIN


_END_KINDS = {
    NodeKind.BOUNDARY: EndKind.BOUNDARY,
    NodeKind.BUFFER: EndKind.BUFFER,
}


def routes_from(
    scheme: Scheme,
    entrance: Signal,
    *,
    index: SignalIndex | None = None,
    limit: Distance = DEFAULT_LIMIT,
) -> list[Route]:
    """Every route that starts at ``entrance``."""
    index = index or SignalIndex(scheme)
    graph = scheme.graph
    found: list[Route] = []

    start = entrance.position
    if not graph.edge(start.edge).permits(start.sense):
        return []
    # A signal standing on a joint has none of its own edge in front of it, so
    # that edge is not part of any route reading from it.
    first: tuple[tuple[str, Sense], ...] = (
        () if start.remaining(graph).metres == 0 else ((start.edge, start.sense),)
    )
    stack: list[tuple[Position, Path, dict[str, Lie], float]] = [
        (start, Path(start=start, steps=first), {}, 0.0)
    ]

    while stack:
        here, path, lies, travelled = stack.pop()
        exit_signal = index.next_on(here.edge, here.sense, here.offset)
        if exit_signal is not None and exit_signal.name != entrance.name:
            reached = travelled + _gap(here.offset, exit_signal.position.offset)
            if reached <= limit.metres:
                found.append(
                    _build(scheme, entrance, exit_signal, path, lies, Distance(reached))
                )
            continue

        run_out = travelled + here.remaining(graph).metres
        if run_out > limit.metres:
            continue

        port = graph.edge(here.edge).port_for(here.sense)
        node = graph.node(port.node)
        end_kind = _END_KINDS.get(node.kind)
        if end_kind is not None:
            found.append(
                _build(
                    scheme,
                    entrance,
                    None,
                    path,
                    lies,
                    Distance(run_out),
                    end=RouteEnd(node.name, end_kind),
                )
            )
            continue

        options = [Lie.NORMAL, Lie.REVERSE] if node.can_be_moved else [Lie.NORMAL]
        for lie in options:
            if node.can_be_moved and lies.get(port.node) not in (None, lie):
                continue
            for next_edge, next_sense in graph.step(here.edge, here.sense, lie):
                if path.uses(next_edge):
                    continue
                edge = graph.edge(next_edge)
                if not edge.permits(next_sense):
                    continue
                offset = Distance(0.0) if next_sense is Sense.NOMINAL else edge.length
                onward_lies = dict(lies)
                if node.can_be_moved:
                    onward_lies[port.node] = lie
                grown = Path(
                    start=path.start,
                    steps=(*path.steps, (next_edge, next_sense)),
                    lies=onward_lies,
                    length=Distance(run_out),
                )
                stack.append(
                    (Position(next_edge, offset, next_sense), grown, onward_lies, run_out)
                )

    return _letter(sorted(found, key=lambda r: (r.klass.value, r.exit.name)))


def _build(
    scheme: Scheme,
    entrance: Signal,
    exit_signal: Signal | None,
    path: Path,
    lies: dict[str, Lie],
    length: Distance,
    end: RouteEnd | None = None,
) -> Route:
    steps = path.steps or ((path.start.edge, path.start.sense),)
    finished = Path(start=path.start, steps=steps, lies=dict(lies), length=length)
    sections = tuple(s.name for s in scheme.sections.over_path(finished))
    if end is None:
        assert exit_signal is not None
        end = RouteEnd.signal(exit_signal.name)
    return Route(
        entrance=entrance.name,
        exit=end,
        klass=_class_for(entrance, exit_signal),
        path=finished,
        points=dict(lies),
        sections=sections,
    )


def _letter(routes: list[Route]) -> list[Route]:
    """Give routes of the same class from one signal an A, B, C suffix."""
    by_class: dict[RouteClass, list[Route]] = {}
    for route in routes:
        by_class.setdefault(route.klass, []).append(route)

    lettered: list[Route] = []
    for klass, group in by_class.items():
        del klass
        if len(group) == 1:
            lettered.extend(group)
            continue
        for offset, route in enumerate(group):
            lettered.append(
                Route(
                    entrance=route.entrance,
                    exit=route.exit,
                    klass=route.klass,
                    path=route.path,
                    points=route.points,
                    sections=route.sections,
                    suffix=chr(ord("A") + offset),
                )
            )
    return sorted(lettered, key=lambda r: r.name)


def all_routes(scheme: Scheme, *, limit: Distance = DEFAULT_LIMIT) -> list[Route]:
    """Every route in the scheme, sorted by entrance signal then route name."""
    from .callon import add_call_on_routes
    from .warning import add_warning_routes

    index = SignalIndex(scheme)
    routes: list[Route] = []
    for signal in scheme.sorted_signals():
        routes.extend(routes_from(scheme, signal, index=index, limit=limit))
    routes = add_warning_routes(scheme, add_call_on_routes(scheme, routes))
    return sorted(routes, key=lambda r: (r.entrance, r.name, r.exit.name))
