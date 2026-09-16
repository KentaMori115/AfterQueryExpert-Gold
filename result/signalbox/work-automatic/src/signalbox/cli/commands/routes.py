"""The routes command."""

from __future__ import annotations

from pathlib import Path

import typer

from ...signalling.route import RouteClass
from ..common import console, fail, grid, load_interlocking


def routes(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    signal: str | None = typer.Option(
        None, "--signal", "-s", help="only routes from this signal"
    ),
    to: str | None = typer.Option(None, "--to", help="only routes ending here"),
    klass: str | None = typer.Option(
        None, "--class", "-c", help="only routes of this class, as M, W, C or S"
    ),
    over: str | None = typer.Option(
        None, "--over", help="only routes running over this section"
    ),
) -> None:
    """List the routes a scheme has."""
    scheme, interlocking = load_interlocking(plan)
    plans = interlocking.from_signal(signal) if signal else interlocking.sorted_plans()
    if signal and not plans:
        fail(f"no routes from {signal}")

    if to is not None:
        plans = [item for item in plans if item.exit == to]
        if not plans:
            fail(f"no routes to {to}")

    if klass is not None:
        wanted = klass.upper()
        known = {member.value for member in RouteClass}
        if wanted not in known:
            fail(f"no route class {klass}, try one of {', '.join(sorted(known))}")
        plans = [item for item in plans if item.klass.value == wanted]
        if not plans:
            fail(f"no routes of class {wanted}")

    if over is not None:
        if over not in scheme.sections:
            fail(f"no section called {over}")
        plans = [item for item in plans if over in item.sections]
        if not plans:
            fail(f"no routes over {over}")

    console.print(
        grid(
            f"routes in {plan.name}",
            ["route", "to", "class", "points", "track"],
            [
                [
                    item.name,
                    str(item.route.exit),
                    item.klass.value,
                    ", ".join(
                        f"{node} {lie.value}" for node, lie in sorted(item.points().items())
                    ),
                    ", ".join(item.sections),
                ]
                for item in plans
            ],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(routes)
