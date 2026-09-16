"""The sim command: run a scenario against a scheme and say what happened."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...sim.log import EventKind
from ...sim.scenario import parse_scenario, run_scenario
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, grid, load

KIND_COLOUR = {
    EventKind.TRAIN: "cyan",
    EventKind.ROUTE: "green",
    EventKind.SIGNAL: "yellow",
    EventKind.POINTS: "magenta",
    EventKind.TRACK: "blue",
    EventKind.NOTE: "white",
}


def sim(
    plan: Path = typer.Argument(..., help="the scheme plan to run against"),
    script: Path = typer.Argument(..., help="the scenario to run"),
    log: bool = typer.Option(False, "--log", "-l", help="print every event"),
    kind: str | None = typer.Option(
        None, "--kind", "-k", help="print events of this kind only"
    ),
) -> None:
    """Run a scenario and report whether it did what it said it would."""
    scheme = load(plan)
    try:
        scenario = parse_scenario(script.read_text(encoding="utf-8"), source=str(script))
    except OSError as exc:
        fail(f"cannot read {script}: {exc.strerror}")
    except SignalboxError as exc:
        fail(str(exc))

    result = run_scenario(scheme, scenario)

    if log or kind:
        events = result.world.log.events
        if kind:
            try:
                wanted = EventKind(kind)
            except ValueError:
                fail(
                    f"no such kind: {kind}, try one of {', '.join(k.value for k in EventKind)}"
                )
            events = result.world.log.of(wanted)
        for event in events:
            colour = KIND_COLOUR[event.kind]
            console.print(f"[{colour}]{event}[/{colour}]", highlight=False)

    for failure in result.failures:
        console.print(f"[red]failed[/red] {failure}", highlight=False)

    if result.ars is not None and result.ars.bookings:
        console.print(result.ars.describe())
    console.print(result.world.log.summary())
    console.print(result.summary())
    raise typer.Exit(EXIT_OK if result.passed else EXIT_FINDINGS)


def trains(
    plan: Path = typer.Argument(..., help="the scheme plan to run against"),
    script: Path = typer.Argument(..., help="the scenario to run"),
) -> None:
    """Run a scenario and print where every train finished up."""
    scheme = load(plan)
    scenario = parse_scenario(script.read_text(encoding="utf-8"), source=str(script))
    result = run_scenario(scheme, scenario)
    world = result.world
    console.print(
        grid(
            f"trains after {scenario.name}",
            ["train", "front", "speed", "sections", "stopped at"],
            [
                [
                    train.name,
                    str(train.front),
                    str(train.speed),
                    ", ".join(train.sections_under(scheme)),
                    train.stopped_at or "-",
                ]
                for train in sorted(world.trains.values(), key=lambda t: t.name)
            ],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(sim)
    app.command()(trains)
