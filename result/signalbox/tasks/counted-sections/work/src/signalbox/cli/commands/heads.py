"""The heads command: where the counting heads go and what resets together."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.heads_table import HEAD_COLUMNS, ZONE_COLUMNS, build_head_schedule
from ..common import console, grid, load


def heads(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    zones: bool = typer.Option(False, "--zones", help="the reset zones instead"),
    shared: bool = typer.Option(False, "--shared", help="only what resets with something else"),
) -> None:
    """Print the head schedule for a scheme's axle counter sections."""
    schedule = build_head_schedule(load(plan))
    if schedule.is_empty:
        console.print("no counted sections in this scheme")
        return
    if zones:
        zone_rows = schedule.wide() if shared else schedule.zones
        if not zone_rows:
            console.print("every reset zone is a single section")
            return
        console.print(
            grid(
                f"reset zones in {plan.name}",
                list(ZONE_COLUMNS),
                [[row.cell(column) for column in ZONE_COLUMNS] for row in zone_rows],
            )
        )
        return
    head_rows = [row for row in schedule if row.is_shared] if shared else list(schedule)
    if not head_rows:
        console.print("no head resets with another section")
        return
    console.print(
        grid(
            f"counting heads in {plan.name}",
            list(HEAD_COLUMNS),
            [[row.cell(column) for column in HEAD_COLUMNS] for row in head_rows],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(heads)
