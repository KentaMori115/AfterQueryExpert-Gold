"""The where command: what mentions this signal, section, points or edge."""

from __future__ import annotations

from pathlib import Path

import typer

from ...tables.index import build_index
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, grid, load_interlocking, raw


def where(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    names: list[str] = typer.Argument(None, help="what to look up"),
    unused: bool = typer.Option(False, "--unused", help="list everything nothing uses instead"),
) -> None:
    """Say where something is used in the interlocking."""
    scheme, interlocking = load_interlocking(plan)
    index = build_index(scheme, interlocking)

    if unused:
        found = index.unused()
        if not found:
            console.print("everything is used by something")
            raise typer.Exit(EXIT_OK)
        console.print(
            grid(
                f"unused in {plan.name}",
                ["name", "kind"],
                [[uses.name, uses.kind] for uses in found],
            )
        )
        raise typer.Exit(EXIT_FINDINGS)

    if not names:
        fail("say what to look up, or pass --unused")

    missing = [name for name in names if index.kind_of(name) is None]
    if missing:
        fail(f"nothing called {', '.join(missing)} in this scheme")

    for name in names:
        uses = index.look_up(name)
        assert uses is not None
        raw(str(uses) + "\n")


def register(app: typer.Typer) -> None:
    app.command()(where)
