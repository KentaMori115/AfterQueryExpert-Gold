"""A line diagram: the stops of one pattern drawn down the page.

This is the picture on the wall of a metro carriage. Each stop gets a mark, the
ends of the line get a different one, and a stop where another route calls says
which one, so a passenger can see where to change without reading a map.
"""

from __future__ import annotations

from typing import Iterable, Optional

from layover.errors import NetworkError
from layover.report.render import Report

__all__ = [
    "END",
    "INTERCHANGE",
    "STOP",
    "diagram_report",
    "line_diagram",
    "route_diagrams",
]

END = "O"
STOP = "|"
INTERCHANGE = "+"


def _changes(network, stop_id: str, route_id: str) -> tuple[str, ...]:
    """Which other routes a passenger could change to at this stop."""
    found = set(network.routes_at(stop_id))
    for sibling in network.siblings_of(stop_id):
        found.update(network.routes_at(sibling))
    found.discard(route_id)
    return tuple(sorted(network.route(other).name for other in sorted(found)))


def diagram_report(network, pattern_id: str, title: str = "") -> Report:
    """One row per call: the mark, the stop, and where to change."""
    pattern = network.pattern(pattern_id)
    route = network.route(pattern.route_id)
    rows = []
    last = len(pattern) - 1
    for index, stop_id in enumerate(pattern.stops):
        changes = _changes(network, stop_id, pattern.route_id)
        if index in (0, last):
            mark = END
        elif changes:
            mark = INTERCHANGE
        else:
            mark = STOP
        rows.append((mark, network.stop(stop_id).name, ", ".join(changes)))
    notes = []
    if pattern.headsign:
        notes.append("Towards %s." % pattern.headsign)
    notes.append("%s, %d stops." % (route.full_name, len(pattern)))
    return Report(
        title or "%s %s" % (route.mode, route.name),
        ("", "Stop", "Change to"),
        tuple(rows),
        tuple(notes),
    )


def line_diagram(network, pattern_id: str, changes: bool = True) -> tuple[str, ...]:
    """The diagram as plain lines, with the track drawn between the stops."""
    report = diagram_report(network, pattern_id)
    width = max(len(row[1]) for row in report.rows)
    lines = []
    for index, row in enumerate(report.rows):
        mark, name, change = row
        line = "%s  %s" % (mark, name.ljust(width))
        if changes and change:
            line += "  change for %s" % change
        lines.append(line.rstrip())
        if index < len(report.rows) - 1:
            lines.append(STOP)
    return tuple(lines)


def route_diagrams(network, route_id: str) -> tuple[Report, ...]:
    """A diagram for each pattern of a route, in pattern order."""
    patterns = network.patterns_of_route(route_id)
    if not patterns:
        raise NetworkError("route %r has no patterns to draw" % (route_id,))
    return tuple(diagram_report(network, pattern_id) for pattern_id in patterns)
