"""The diff command."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.control_table import COLUMNS, build_control_table
from ...tables.diff import Change, diff_tables
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load_interlocking

CHANGE_COLOUR = {
    Change.ADDED: "green",
    Change.REMOVED: "red",
    Change.CHANGED: "yellow",
}


def diff(
    before: Path = typer.Argument(..., help="the plan as it was"),
    after: Path = typer.Argument(..., help="the plan as it is now"),
    columns: str | None = typer.Option(
        None, "--columns", "-c", help="compare these columns only"
    ),
    summary: bool = typer.Option(False, "--summary", help="print the counts and nothing else"),
) -> None:
    """Compare the control tables of two scheme plans."""
    old_scheme, old_lock = load_interlocking(before)
    new_scheme, new_lock = load_interlocking(after)

    chosen = COLUMNS if columns is None else tuple(name.strip() for name in columns.split(","))
    unknown = [name for name in chosen if name not in COLUMNS]
    if unknown:
        fail(f"no such column: {', '.join(unknown)}")

    result = diff_tables(
        build_control_table(old_scheme, old_lock),
        build_control_table(new_scheme, new_lock),
        columns=chosen,
    )

    if not summary:
        for change in result:
            colour = CHANGE_COLOUR[change.change]
            console.print(f"[{colour}]{change}[/{colour}]", highlight=False)
    console.print(result.summary())
    raise typer.Exit(EXIT_OK if result.empty else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(diff)
