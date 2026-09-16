"""The distance command: how far it is from one thing to another."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...topology.graph import Lie
from ...topology.measure import between
from ...units import Distance
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, grid, load


def distance(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    start: str = typer.Argument(..., help="what to measure from"),
    end: str = typer.Argument(..., help="what to measure to"),
    reverse: list[str] | None = typer.Option(
        None, "--reverse", help="points to take as lying reverse"
    ),
    limit: float = typer.Option(20000.0, "--limit", help="how far to walk before giving up"),
) -> None:
    """Measure along the track between two named things."""
    scheme = load(plan)
    if limit <= 0:
        fail("the limit has to be a distance")

    lies = {name: Lie.REVERSE for name in (reverse or [])}
    unknown = [name for name in lies if name not in scheme.graph.nodes]
    if unknown:
        fail(f"no points called {', '.join(unknown)}")

    try:
        found = between(scheme, start, end, lies=lies, search=Distance(limit))
    except SignalboxError as exc:
        fail(str(exc))

    if found is None:
        console.print(f"no way from {start} to {end} within {limit:.0f}m")
        raise typer.Exit(EXIT_FINDINGS)

    console.print(
        grid(
            f"{start} to {end}",
            ["metres", "yards", "mileage", "over"],
            [
                [
                    f"{found.metres:.0f}",
                    f"{found.distance.yards:.0f}",
                    str(found.distance),
                    ", ".join(found.edges),
                ]
            ],
        )
    )
    raise typer.Exit(EXIT_OK)


def register(app: typer.Typer) -> None:
    app.command()(distance)
