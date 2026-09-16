"""The aspects and berths commands, which are the tester's end of the job."""

from __future__ import annotations

from pathlib import Path

import typer

from ...signalling.berth import berth_section, steps, without_berths
from ...signalling.tpws import all_grids
from ...tables.aspect_table import ASPECT_COLUMNS, build_aspect_table
from ..common import console, fail, grid, load_interlocking


def aspects(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    signal: str | None = typer.Option(None, "--signal", "-s", help="one signal only"),
    clamped: bool = typer.Option(
        False, "--clamped", help="only rows where the signal cannot show what is wanted"
    ),
) -> None:
    """Print the aspect sequence for every route that clears a signal."""
    scheme, interlocking = load_interlocking(plan)
    table = build_aspect_table(scheme, interlocking)

    rows = table.clamped() if clamped else list(table)
    if signal is not None:
        rows = [row for row in rows if row.signal == signal]
        if not rows:
            fail(f"no aspect sequence for {signal}")
    if not rows:
        console.print("nothing to report")
        return

    console.print(
        grid(
            f"aspects in {plan.name}",
            list(ASPECT_COLUMNS),
            [[row.cell(column) for column in ASPECT_COLUMNS] for row in rows],
        )
    )


def berths(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    describer: bool = typer.Option(False, "--steps", help="print the describer steps"),
) -> None:
    """Print the berth track for each signal, or the describer steps between them."""
    scheme, interlocking = load_interlocking(plan)

    if describer:
        rows = [
            [step.from_berth, step.to_berth, step.over] for step in steps(scheme, interlocking)
        ]
        if not rows:
            console.print("no describer steps in this scheme")
            return
        console.print(grid(f"describer steps in {plan.name}", ["from", "to", "past"], rows))
        return

    missing = set(without_berths(scheme))
    console.print(
        grid(
            f"berths in {plan.name}",
            ["signal", "berth", "protection"],
            [
                [
                    signal.name,
                    berth_section(scheme, signal.name) or "none",
                    ", ".join(
                        g.kind.value for g in all_grids(scheme) if g.signal == signal.name
                    )
                    or "-",
                ]
                for signal in scheme.sorted_signals()
            ],
        )
    )
    if missing:
        console.print(f"[yellow]{len(missing)} signals have no berth[/yellow]")


def register(app: typer.Typer) -> None:
    app.command()(aspects)
    app.command()(berths)
