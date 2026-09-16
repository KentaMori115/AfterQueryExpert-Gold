"""The show command: what is in this plan, before anything is worked out."""

from __future__ import annotations

from pathlib import Path

import typer

from ...layout.ast import NodeKind
from ..common import console, grid, load, load_interlocking


def show(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
    detail: bool = typer.Option(False, "--detail", "-d", help="list the track as well"),
) -> None:
    """Summarise a scheme plan."""
    scheme = load(plan)
    console.print(scheme.describe())

    counts: dict[str, int] = {}
    for node in scheme.graph.nodes.values():
        counts[node.kind.value] = counts.get(node.kind.value, 0) + 1
    console.print(", ".join(f"{count} {kind}" for kind, count in sorted(counts.items())))

    total = sum(edge.length.metres for edge in scheme.graph.edges.values())
    console.print(f"{total / 1000:.2f} km of track in {len(scheme.graph)} edges")
    console.print(f"designed to {scheme.standards.describe()}")

    if scheme.crossings:
        console.print(
            grid(
                "level crossings",
                ["crossing", "on", "at", "kind", "proves"],
                [
                    [
                        name,
                        scheme.crossing(name).position.edge,
                        f"{scheme.crossing(name).position.offset.metres:.0f}m",
                        scheme.crossing(name).kind.value,
                        scheme.crossing(name).requirement(),
                    ]
                    for name in sorted(scheme.crossings)
                ],
            )
        )

    if scheme.traps:
        console.print(
            grid(
                "traps",
                ["trap", "on", "at", "catches"],
                [
                    [
                        name,
                        scheme.trap(name).position.edge,
                        f"{scheme.trap(name).position.offset.metres:.0f}m",
                        scheme.trap(name).sense.name.lower(),
                    ]
                    for name in sorted(scheme.traps)
                ],
            )
        )

    if not detail:
        return

    console.print(
        grid(
            f"track in {plan.name}",
            ["edge", "from", "to", "length", "speed", "gradient", "worked", "section"],
            [
                [
                    name,
                    str(edge.start),
                    str(edge.end),
                    f"{edge.length.metres:.0f}m",
                    str(edge.speed) if edge.speed else "-",
                    str(edge.gradient),
                    edge.direction,
                    scheme.sections.name_for(name) or "-",
                ]
                for name, edge in sorted(scheme.graph.edges.items())
            ],
        )
    )


def signals(
    plan: Path = typer.Argument(..., help="the scheme plan to read"),
) -> None:
    """List the signals, with how many routes read from each."""
    scheme, interlocking = load_interlocking(plan)
    console.print(
        grid(
            f"signals in {plan.name}",
            ["signal", "on", "at", "heads", "type", "direction", "routes"],
            [
                [
                    signal.name,
                    signal.position.edge,
                    f"{signal.position.offset.metres:.0f}m",
                    str(signal.heads),
                    signal.type.value,
                    signal.attributes.get("direction", "-"),
                    str(len(interlocking.from_signal(signal.name))),
                ]
                for signal in scheme.sorted_signals()
            ],
        )
    )


def register(app: typer.Typer) -> None:
    app.command()(show)
    app.command()(signals)


BOUNDARY_KINDS = (NodeKind.BOUNDARY, NodeKind.BUFFER)
