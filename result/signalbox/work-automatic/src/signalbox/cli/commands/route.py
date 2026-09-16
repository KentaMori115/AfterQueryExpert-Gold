"""The route command: everything known about one route, on one page."""

from __future__ import annotations

from pathlib import Path

import typer

from ...signalling.approach import approach_lock_for
from ...signalling.aspects import build_chart
from ...signalling.automatic import automatic_working
from ...signalling.conflict import build_matrix
from ...signalling.crossing import requirements_for
from ...signalling.locking import build_locking
from ...signalling.profile_helpers import route_profile
from ..common import console, fail, grid, load_interlocking


def route(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    name: str = typer.Argument(..., help="the route to describe"),
) -> None:
    """Print everything the interlocking knows about one route."""
    scheme, interlocking = load_interlocking(plan)
    if name not in interlocking:
        known = ", ".join(item.name for item in interlocking)
        fail(f"no route called {name}, try one of {known}")

    item = interlocking.plan(name)
    matrix = build_matrix(interlocking)
    locking = build_locking(interlocking, matrix)
    entry = locking.entry(name)
    chart = build_chart(scheme, interlocking)
    approach = approach_lock_for(scheme, item)
    rule = chart.rule(name)
    shape = route_profile(scheme, item)
    worked_by = automatic_working(scheme, interlocking).signal_of(name)

    rows = [
        ["from", item.entrance],
        ["to", str(item.route.exit)],
        ["class", item.klass.value],
        ["length", str(item.route.length)],
        ["over", ", ".join(item.route.edges)],
        ["track held", ", ".join(sub.name for sub in entry.held_track())],
        ["points", ", ".join(f"{n} {lie.value}" for n, lie in sorted(entry.points.items()))],
        ["overlap", ", ".join(o.name for o in item.overlaps) or "none"],
        ["flank", ", ".join(flank.requirement() for flank in item.flanks) or "none"],
        ["crossings", ", ".join(requirements_for(scheme, item)) or "none"],
        ["release", entry.release.value],
        ["worked", "automatically" if worked_by else "from the panel"],
        ["approach", approach.describe()],
        ["locks out", ", ".join(entry.locks_out) or "nothing"],
        ["aspects", str(rule) if rule is not None else "shunt, no aspect"],
        ["gradient", shape.describe()],
    ]
    console.print(grid(name, ["", ""], rows))


def register(app: typer.Typer) -> None:
    app.command()(route)
