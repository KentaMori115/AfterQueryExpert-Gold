"""The points and flanks commands, which read the interlocking sideways."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.points_table import POINT_COLUMNS, build_points_table
from ..common import console, grid, load_interlocking


def points(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    facing: bool = typer.Option(False, "--facing", help="only points with a facing move"),
) -> None:
    """Print the points table, which is the interlocking read points first."""
    scheme, interlocking = load_interlocking(plan)
    table = build_points_table(scheme, interlocking)
    rows = table.facing() if facing else list(table)
    if not rows:
        console.print("no points in this scheme")
        return
    console.print(
        grid(
            f"points in {plan.name}",
            list(POINT_COLUMNS),
            [[row.cell(column) for column in POINT_COLUMNS] for row in rows],
        )
    )


def flanks(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    open_only: bool = typer.Option(False, "--open", help="only flanks nothing protects"),
) -> None:
    """Print every flank in the scheme and what holds it shut."""
    _scheme, interlocking = load_interlocking(plan)
    rows = []
    for item in interlocking:
        for flank in item.flanks:
            if open_only and flank.protected:
                continue
            where = f"{flank.node}.{flank.port}" if flank.port else flank.node
            rows.append(
                [
                    item.name,
                    where,
                    flank.kind.value,
                    flank.requirement(),
                    f"{flank.distance.metres:.0f}m",
                ]
            )
    if not rows:
        console.print("nothing to report")
        return
    console.print(
        grid(f"flanks in {plan.name}", ["route", "at", "kind", "held by", "distance"], rows)
    )


def register(app: typer.Typer) -> None:
    app.command()(points)
    app.command()(flanks)
