"""The draw command: turn a scheme plan into a schematic."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...render.geometry import DEFAULT_SCALE, DEFAULT_SPACING, place
from ...render.svg import render_svg
from ...sim.scenario import parse_scenario, run_scenario
from ..common import console, fail, load, raw


def draw(
    plan: Path = typer.Argument(..., help="the scheme plan to draw"),
    out: Path | None = typer.Option(None, "--out", "-o", help="write here instead of stdout"),
    scale: float = typer.Option(DEFAULT_SCALE, "--scale", help="schematic units per metre"),
    spacing: float = typer.Option(DEFAULT_SPACING, "--spacing", help="gap between roads"),
    datum: str | None = typer.Option(None, "--datum", help="node to start the layout from"),
    title: str | None = typer.Option(None, "--title", help="heading for the drawing"),
    legend: bool = typer.Option(False, "--legend", help="draw a key under the schematic"),
    after: Path | None = typer.Option(
        None, "--after", help="run this scenario first and draw the state it leaves"
    ),
) -> None:
    """Draw a scheme, optionally showing where a scenario left everything."""
    scheme = load(plan)
    if scale <= 0:
        fail("scale must be greater than zero")
    if datum is not None and datum not in scheme.graph.nodes:
        fail(f"no node called {datum}")

    occupied: set[str] = set()
    aspects: dict[str, object] = {}
    if after is not None:
        try:
            scenario = parse_scenario(after.read_text(encoding="utf-8"), source=str(after))
        except OSError as exc:
            fail(f"cannot read {after}: {exc.strerror}")
        except SignalboxError as exc:
            fail(str(exc))
        result = run_scenario(scheme, scenario)
        occupied = result.world.occupancy()
        aspects = dict(result.world.machine.state.aspects)

    placement = place(scheme, scale=scale, spacing=spacing, datum=datum)
    drawing = render_svg(
        scheme,
        placement,
        occupied=occupied,
        aspects=aspects,  # type: ignore[arg-type]
        title=title,
        legend=legend,
    )

    if out is None:
        raw(drawing)
        return
    try:
        out.write_text(drawing, encoding="utf-8")
    except OSError as exc:
        fail(f"cannot write {out}: {exc.strerror}")
    console.print(f"wrote {out} ({len(drawing)} bytes)")


def register(app: typer.Typer) -> None:
    app.command()(draw)
