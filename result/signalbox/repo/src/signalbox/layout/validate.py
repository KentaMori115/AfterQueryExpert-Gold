"""Cross checks that the parser deliberately does not do.

The parser records what was written. This module decides whether the writing
describes something a railway could be built from: names used once, references
that resolve, ports that exist on the node they name, and nodes that have the
right number of edges attached to them.
"""

from __future__ import annotations

from ..errors import DuplicateNameError, LayoutError, UnknownReferenceError
from .ast import (
    CROSSING_PORTS,
    POINT_PORTS,
    SLIP_PORTS,
    EndRef,
    NodeKind,
    SchemeDecl,
)

#: How many edge ends a node of each kind must have attached to it.
REQUIRED_DEGREE = {
    NodeKind.BOUNDARY: 1,
    NodeKind.BUFFER: 1,
    NodeKind.PLAIN: 2,
    NodeKind.POINTS: 3,
    NodeKind.CROSSING: 4,
    NodeKind.SLIP: 4,
}

_PORTS_BY_KIND = {
    NodeKind.POINTS: set(POINT_PORTS),
    NodeKind.CROSSING: set(CROSSING_PORTS),
    NodeKind.SLIP: set(SLIP_PORTS),
}

#: How many edges may attach at an unnamed end. A plain join has two, because
#: neither side of it is worth naming; everything else has one or names its ports.
UNNAMED_CAPACITY = {
    NodeKind.BOUNDARY: 1,
    NodeKind.BUFFER: 1,
    NodeKind.PLAIN: 2,
}


def validate(scheme: SchemeDecl) -> None:
    """Raise the first problem found in ``scheme``."""
    _check_unique_names(scheme)
    _check_edge_endpoints(scheme)
    _check_node_degrees(scheme)
    _check_sections(scheme)
    _check_signals(scheme)
    _check_directions(scheme)
    _check_crossings(scheme)
    _check_traps(scheme)


def _fail(error: type[LayoutError], scheme: SchemeDecl, line: int, message: str) -> LayoutError:
    return error(message, source=scheme.source, line=line)


def _check_unique_names(scheme: SchemeDecl) -> None:
    seen: dict[str, str] = {}
    for group, declarations in (
        ("node", scheme.nodes),
        ("edge", scheme.edges),
        ("section", scheme.sections),
        ("signal", scheme.signals),
        ("crossing", scheme.crossings),
        ("trap", scheme.traps),
    ):
        for decl in declarations:
            if decl.name in seen:
                raise _fail(
                    DuplicateNameError,
                    scheme,
                    getattr(decl, "line", 0),
                    f"{group} {decl.name} is already declared as a {seen[decl.name]}",
                )
            seen[decl.name] = group


def _check_end(scheme: SchemeDecl, end: EndRef, line: int, edge_name: str) -> None:
    node = scheme.node(end.node)
    if node is None:
        raise _fail(
            UnknownReferenceError,
            scheme,
            line,
            f"edge {edge_name} ends at unknown node {end.node}",
        )
    ports = _PORTS_BY_KIND.get(node.kind)
    if ports is None:
        if end.port is not None:
            raise _fail(
                UnknownReferenceError,
                scheme,
                line,
                f"node {end.node} is {node.kind.value} and has no port {end.port!r}",
            )
        return
    if end.port is None:
        raise _fail(
            UnknownReferenceError,
            scheme,
            line,
            f"edge {edge_name} must say which end of {end.node} it joins, "
            f"one of {', '.join(sorted(ports))}",
        )
    if end.port not in ports:
        raise _fail(
            UnknownReferenceError,
            scheme,
            line,
            f"node {end.node} has no port {end.port!r}, "
            f"expected one of {', '.join(sorted(ports))}",
        )


def _check_edge_endpoints(scheme: SchemeDecl) -> None:
    used: dict[tuple[str, str | None], list[str]] = {}
    for edge in scheme.edges:
        if edge.length_metres <= 0:
            raise _fail(
                LayoutError,
                scheme,
                edge.line,
                f"edge {edge.name} has a length of {edge.length_metres}",
            )
        if edge.start == edge.end:
            raise _fail(
                LayoutError,
                scheme,
                edge.line,
                f"edge {edge.name} starts and ends at {edge.start}",
            )
        for end in (edge.start, edge.end):
            _check_end(scheme, end, edge.line, edge.name)
            key = (end.node, end.port)
            attached = used.setdefault(key, [])
            node = scheme.node(end.node)
            assert node is not None
            capacity = 1 if end.port is not None else UNNAMED_CAPACITY[node.kind]
            if len(attached) >= capacity:
                raise _fail(
                    LayoutError,
                    scheme,
                    edge.line,
                    f"{end} already has edge {attached[0]} attached to it",
                )
            attached.append(edge.name)


def _check_node_degrees(scheme: SchemeDecl) -> None:
    degree: dict[str, int] = {node.name: 0 for node in scheme.nodes}
    for edge in scheme.edges:
        degree[edge.start.node] += 1
        degree[edge.end.node] += 1
    for node in scheme.nodes:
        wanted = REQUIRED_DEGREE[node.kind]
        found = degree[node.name]
        if found != wanted:
            raise _fail(
                LayoutError,
                scheme,
                node.line,
                f"{node.kind.value} {node.name} has {found} edges attached, it needs {wanted}",
            )


def _check_sections(scheme: SchemeDecl) -> None:
    claimed: dict[str, str] = {}
    for section in scheme.sections:
        if not section.edges:
            raise _fail(
                LayoutError, scheme, section.line, f"section {section.name} covers nothing"
            )
        for edge_name in section.edges:
            if scheme.edge(edge_name) is None:
                raise _fail(
                    UnknownReferenceError,
                    scheme,
                    section.line,
                    f"section {section.name} covers unknown edge {edge_name}",
                )
            if edge_name in claimed:
                raise _fail(
                    LayoutError,
                    scheme,
                    section.line,
                    f"edge {edge_name} is already in section {claimed[edge_name]}",
                )
            claimed[edge_name] = section.name


def _check_signals(scheme: SchemeDecl) -> None:
    for signal in scheme.signals:
        edge = scheme.edge(signal.edge)
        if edge is None:
            raise _fail(
                UnknownReferenceError,
                scheme,
                signal.line,
                f"signal {signal.name} stands on unknown edge {signal.edge}",
            )
        if not 0.0 <= signal.offset_metres <= edge.length_metres:
            raise _fail(
                LayoutError,
                scheme,
                signal.line,
                f"signal {signal.name} is {signal.offset_metres}m along "
                f"edge {edge.name} which is only {edge.length_metres}m long",
            )
        if signal.aspects not in (2, 3, 4):
            raise _fail(
                LayoutError,
                scheme,
                signal.line,
                f"signal {signal.name} has {signal.aspects} aspects, expected 2, 3 or 4",
            )


def _check_crossings(scheme: SchemeDecl) -> None:
    for crossing in scheme.crossings:
        edge = scheme.edge(crossing.edge)
        if edge is None:
            raise _fail(
                UnknownReferenceError,
                scheme,
                crossing.line,
                f"crossing {crossing.name} is on unknown edge {crossing.edge}",
            )
        if not 0.0 <= crossing.offset_metres <= edge.length_metres:
            raise _fail(
                LayoutError,
                scheme,
                crossing.line,
                f"crossing {crossing.name} is {crossing.offset_metres}m along "
                f"edge {edge.name} which is only {edge.length_metres}m long",
            )


def _check_traps(scheme: SchemeDecl) -> None:
    for trap in scheme.traps:
        edge = scheme.edge(trap.edge)
        if edge is None:
            raise _fail(
                UnknownReferenceError,
                scheme,
                trap.line,
                f"trap {trap.name} is on unknown edge {trap.edge}",
            )
        if not 0.0 <= trap.offset_metres <= edge.length_metres:
            raise _fail(
                LayoutError,
                scheme,
                trap.line,
                f"trap {trap.name} is {trap.offset_metres}m along edge {edge.name} "
                f"which is only {edge.length_metres}m long",
            )


def _check_directions(scheme: SchemeDecl) -> None:
    """A signal may not point against the only direction its track is worked in."""
    for signal in scheme.signals:
        edge = scheme.edge(signal.edge)
        if edge is None:
            continue
        track = edge.attributes.get("direction")
        wanted = signal.attributes.get("direction")
        if track is None or wanted is None:
            continue
        if track in ("bidirectional", wanted):
            continue
        raise _fail(
            LayoutError,
            scheme,
            signal.line,
            f"signal {signal.name} works {wanted} trains but edge {edge.name} is {track} only",
        )
