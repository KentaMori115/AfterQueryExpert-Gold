"""The chainage command: where everything is in miles and chains."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...topology.chainage import chainage as work_out
from ..common import console, fail, grid, load


def chainage(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    datum: str | None = typer.Option(None, "--datum", help="node to measure from"),
    signals: bool = typer.Option(False, "--signals", help="mileage of the signals instead"),
) -> None:
    """Work the mileage out for every node, or for every signal."""
    scheme = load(plan)
    try:
        marks = work_out(scheme, datum=datum)
    except SignalboxError as exc:
        fail(str(exc))

    if marks.is_empty:
        console.print('no mileage in this scheme, put one on an edge with mileage "12m 34ch"')
        return

    if signals:
        rows = []
        for signal in scheme.sorted_signals():
            edge = scheme.graph.edge(signal.position.edge)
            if not marks.known(edge.start.node):
                continue
            rows.append(
                [
                    signal.name,
                    signal.position.edge,
                    str(marks.of(scheme, signal.position)),
                    signal.attributes.get("direction", "-"),
                ]
            )
        console.print(
            grid(f"signal mileage in {plan.name}", ["signal", "edge", "at", "direction"], rows)
        )
        console.print(marks.describe())
        return

    console.print(
        grid(
            f"mileage in {plan.name}",
            ["node", "kind", "at"],
            [
                [name, scheme.graph.node(name).kind.value, str(marks.at(name))]
                for name in sorted(marks.nodes)
            ],
        )
    )
    missing = marks.missing(scheme)
    if missing:
        console.print(
            f"[yellow]{len(missing)} nodes not reached: {', '.join(missing)}[/yellow]"
        )
    console.print(marks.describe())


def register(app: typer.Typer) -> None:
    app.command()(chainage)
