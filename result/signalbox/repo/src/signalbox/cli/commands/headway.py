"""The headway command: what service the signalling will actually carry."""

from __future__ import annotations

from pathlib import Path

import typer

from ...signalling.headway import legs, summarise, worst
from ...units import Distance
from ..common import console, fail, grid, load_interlocking


def headway(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    train: float = typer.Option(200.0, "--train", help="planning train length in metres"),
    slowest: bool = typer.Option(False, "--worst", help="print the worst block only"),
) -> None:
    """Work out the headway each block allows, and so the headway of the line."""
    scheme, interlocking = load_interlocking(plan)
    if train <= 0:
        fail("a train has to have some length")

    found = legs(scheme, interlocking, train=Distance(train))
    if not found:
        console.print("no blocks to measure")
        return

    if slowest:
        best_of_a_bad_lot = worst(found)
        rows = [best_of_a_bad_lot] if best_of_a_bad_lot is not None else []
    else:
        rows = sorted(found, key=lambda leg: -leg.seconds)
    console.print(
        grid(
            f"headway in {plan.name}",
            ["route", "from", "to", "length", "speed", "heads", "headway", "trains/hr"],
            [
                [
                    leg.route,
                    leg.entrance,
                    leg.exit,
                    f"{leg.length.metres:.0f}m",
                    str(leg.speed),
                    str(leg.heads),
                    f"{leg.seconds:.0f}s",
                    f"{leg.trains_per_hour:.1f}",
                ]
                for leg in rows
            ],
        )
    )
    console.print(summarise(found))


def register(app: typer.Typer) -> None:
    app.command()(headway)
