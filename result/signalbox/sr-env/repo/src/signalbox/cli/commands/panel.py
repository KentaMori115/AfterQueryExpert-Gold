"""The panel command: draw the railway as it stood at one moment of a run."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...render.panel import render_panel
from ...sim.replay import Replay
from ...sim.scenario import parse_scenario, run_scenario
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load, raw


def panel(
    plan: Path = typer.Argument(..., help="the scheme plan to run against"),
    script: Path = typer.Argument(..., help="the scenario to run"),
    at: float = typer.Option(
        None, "--at", help="the moment to draw, in seconds; the end of the run by default"
    ),
    out: Path | None = typer.Option(None, "--out", "-o", help="write here instead of stdout"),
    title: str | None = typer.Option(None, "--title", help="heading for the drawing"),
) -> None:
    """Draw the panel as it stood at one moment."""
    scheme = load(plan)
    try:
        scenario = parse_scenario(script.read_text(encoding="utf-8"), source=str(script))
    except OSError as exc:
        fail(f"cannot read {script}: {exc.strerror}")
    except SignalboxError as exc:
        fail(str(exc))

    result = run_scenario(scheme, scenario)
    replay = Replay(result.world.history, result.world.log)
    start, end = replay.span

    moment = end if at is None else at
    if moment < start or moment > end:
        fail(f"the run covers {start:.0f}s to {end:.0f}s, not {moment:.0f}s")

    state = result.world.machine.state
    drawing = render_panel(
        scheme,
        state,
        fixes=replay.at(moment).fixes,
        title=title or f"{scheme.area or scheme.name} at {moment:.0f}s",
    )

    if out is None:
        raw(drawing)
    else:
        try:
            out.write_text(drawing, encoding="utf-8")
        except OSError as exc:
            fail(f"cannot write {out}: {exc.strerror}")
        console.print(f"wrote {out} ({len(drawing)} bytes)")

    raise typer.Exit(EXIT_OK if result.passed else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(panel)
