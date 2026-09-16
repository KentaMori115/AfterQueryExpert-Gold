"""The set command: ask for routes and see what the interlocking says."""

from __future__ import annotations

from pathlib import Path

import typer

from ...sim.machine import Machine
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, grid, load_interlocking


def set_routes(
    plan: Path = typer.Argument(..., help="the scheme plan to work"),
    names: list[str] = typer.Argument(..., help="the routes to ask for, in order"),
    occupied: list[str] | None = typer.Option(
        None, "--occupied", help="a section with something standing on it"
    ),
    seconds: float = typer.Option(
        60.0, "--wait", help="how long to let the points move between requests"
    ),
) -> None:
    """Ask the interlocking for routes and report what it does.

    This is the panel without the panel: it answers "why will it not let me set
    that" without having to write a scenario file first.
    """
    scheme, interlocking = load_interlocking(plan)
    machine = Machine(scheme, interlocking)

    unknown = [name for name in names if name not in interlocking]
    if unknown:
        fail(f"no route called {', '.join(unknown)}")

    for section in occupied or []:
        if section not in scheme.sections:
            fail(f"no section called {section}")
        machine.occupy(section)

    rows = []
    refused = 0
    for name in names:
        outcome = machine.request(name)
        machine.tick(seconds)
        if not outcome:
            refused += 1
        rows.append(
            [
                name,
                "set" if outcome else "refused",
                outcome.reason or "-",
                str(machine.showing(interlocking.plan(name).entrance)),
            ]
        )

    console.print(grid(f"setting in {plan.name}", ["route", "outcome", "why", "signal"], rows))
    held = [state.name for state in machine.state.held_routes()]
    console.print(f"{len(held)} routes held: {', '.join(sorted(held)) or 'none'}")
    raise typer.Exit(EXIT_OK if refused == 0 else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command("set")(set_routes)
