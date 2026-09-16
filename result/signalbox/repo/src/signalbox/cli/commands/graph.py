"""The graph command: run a scenario and draw the train graph from it."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...render.timeline import DEFAULT_HEIGHT, DEFAULT_WIDTH, render_timeline
from ...sim.scenario import parse_scenario, run_scenario
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load, raw


def graph(
    plan: Path = typer.Argument(..., help="the scheme plan to run against"),
    script: Path = typer.Argument(..., help="the scenario to run"),
    out: Path | None = typer.Option(None, "--out", "-o", help="write here instead of stdout"),
    width: float = typer.Option(DEFAULT_WIDTH, "--width", help="drawing width"),
    height: float = typer.Option(DEFAULT_HEIGHT, "--height", help="drawing height"),
    title: str | None = typer.Option(None, "--title", help="heading for the drawing"),
) -> None:
    """Draw distance against time for every train in a scenario."""
    scheme = load(plan)
    if width <= 0 or height <= 0:
        fail("the drawing has to have a size")

    try:
        scenario = parse_scenario(script.read_text(encoding="utf-8"), source=str(script))
    except OSError as exc:
        fail(f"cannot read {script}: {exc.strerror}")
    except SignalboxError as exc:
        fail(str(exc))

    result = run_scenario(scheme, scenario)
    if not result.world.history:
        fail("nothing ran, so there is nothing to graph")

    drawing = render_timeline(
        scheme,
        result.world.history,
        width=width,
        height=height,
        title=title or f"{scheme.area or scheme.name}: {scenario.name}",
    )

    if out is None:
        raw(drawing)
    else:
        try:
            out.write_text(drawing, encoding="utf-8")
        except OSError as exc:
            fail(f"cannot write {out}: {exc.strerror}")
        console.print(f"wrote {out} ({len(drawing)} bytes)")
        console.print(result.world.history.summary())

    raise typer.Exit(EXIT_OK if result.passed else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(graph)
