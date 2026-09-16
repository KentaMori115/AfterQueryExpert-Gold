"""The automatic command: which signals the trains work, and which cannot."""

from __future__ import annotations

from pathlib import Path

import typer

from ...signalling.automatic import AutomaticWorking, AutoSignal, automatic_working
from ...signalling.conflict import build_matrix
from ...signalling.interlocking import Interlocking
from ..common import console, grid, load_interlocking


def _row(found: AutoSignal) -> list[str]:
    return [
        found.signal,
        found.route or "-",
        "yes" if found.works else "no",
        ", ".join(found.watching) or "-",
        found.detail if found.detail else ("" if found.works else str(found.fault)),
    ]


def _locked_out(interlocking: Interlocking, working: AutomaticWorking) -> list[list[str]]:
    """The panel moves an automatic route will never let a signaller have.

    An automatic route stands set, so anything signalled against it is refused
    every time it is asked for. That is worth printing beside the signal that
    does it, because on the control table it looks like an ordinary route.
    """
    matrix = build_matrix(interlocking)
    automatic = set(working.routes())
    rows = []
    for plan in interlocking:
        if plan.name in automatic:
            continue
        against = sorted(set(matrix.against(plan.name)) & automatic)
        if against:
            rows.append([plan.name, ", ".join(against)])
    return rows


def automatic(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    faults: bool = typer.Option(
        False, "--faults", help="only the signals that cannot be worked automatically"
    ),
    locks: bool = typer.Option(
        False, "--locks", help="the routes an automatic one will never let go of"
    ),
) -> None:
    """Print the automatic signals and the routes they work."""
    scheme, interlocking = load_interlocking(plan)
    working = automatic_working(scheme, interlocking)

    if locks:
        rows = _locked_out(interlocking, working)
        if not rows:
            console.print(f"nothing in {plan.name} is locked out by an automatic route")
            return
        console.print(
            grid(f"locked out in {plan.name}", ["route", "against"], rows)
        )
        return

    found = working.faults() if faults else working.sorted_signals()
    if not found:
        console.print(f"nothing in {plan.name} is worked automatically")
        return

    console.print(
        grid(
            f"automatic signals in {plan.name}",
            ["signal", "route", "works", "watches", "why not"],
            [_row(entry) for entry in found],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(automatic)
