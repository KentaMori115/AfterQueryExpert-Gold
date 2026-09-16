"""The table command."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.control_table import COLUMNS, build_control_table
from ...tables.render import NARROW, RENDERERS, render
from ...tables.sorting import apply
from ..common import fail, load_interlocking, raw


def table(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    fmt: str = typer.Option("text", "--format", "-f", help="text, csv or markdown"),
    columns: str | None = typer.Option(
        None, "--columns", "-c", help="comma separated column names, or 'narrow'"
    ),
    route: str | None = typer.Option(None, "--route", "-r", help="print one route only"),
    sort: list[str] | None = typer.Option(
        None, "--sort", help="sort by this column, repeat for a second key"
    ),
    where: list[str] | None = typer.Option(
        None, "--where", help="keep rows whose column contains text, as column=text"
    ),
) -> None:
    """Print the control table."""
    scheme, interlocking = load_interlocking(plan)
    control = build_control_table(scheme, interlocking)

    chosen: tuple[str, ...]
    if columns is None:
        chosen = COLUMNS
    elif columns == "narrow":
        chosen = NARROW
    else:
        chosen = tuple(name.strip() for name in columns.split(","))

    rows = list(control)
    if route is not None:
        rows = [row for row in rows if row.route == route]
        if not rows:
            fail(f"no route called {route}")

    try:
        rows = apply(rows, sort=sort or (), filters=where or ())
    except (KeyError, ValueError) as exc:
        fail(str(exc).strip("'"))
    if not rows:
        fail("nothing matched")

    if fmt not in RENDERERS:
        fail(f"no such format: {fmt}, try one of {', '.join(sorted(RENDERERS))}")

    try:
        text = render(rows, fmt, chosen)
    except KeyError as exc:
        fail(str(exc).strip("'"))
    raw(text)


def register(app: typer.Typer) -> None:
    app.command()(table)
