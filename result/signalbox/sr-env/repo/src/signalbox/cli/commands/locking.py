"""The locking command: what each route holds once it is set."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.locking_table import LOCKING_COLUMNS, build_locking_report
from ..common import console, fail, grid, load_interlocking


def locking(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    route: str | None = typer.Option(None, "--route", "-r", help="one route only"),
    subroute: str | None = typer.Option(
        None, "--subroute", help="which routes hold this piece of track"
    ),
    sectional: bool = typer.Option(
        False, "--sectional", help="only routes that release section by section"
    ),
) -> None:
    """Print the locking table."""
    _scheme, interlocking = load_interlocking(plan)
    report = build_locking_report(interlocking)

    if subroute is not None:
        holders = report.holders_of(subroute)
        if not holders:
            fail(f"nothing holds {subroute}")
        console.print(grid(f"holders of {subroute}", ["route"], [[name] for name in holders]))
        return

    rows = report.sectional() if sectional else list(report)
    if route is not None:
        rows = [row for row in rows if row.route == route]
        if not rows:
            fail(f"no route called {route}")

    console.print(
        grid(
            f"locking in {plan.name}",
            list(LOCKING_COLUMNS),
            [[row.cell(column) for column in LOCKING_COLUMNS] for row in rows],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(locking)
