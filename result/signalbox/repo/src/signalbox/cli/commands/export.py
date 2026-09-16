"""The export and compare commands, which are the handover end of the job."""

from __future__ import annotations

from pathlib import Path

import typer

from ...interchange.compare import compare as compare_data
from ...interchange.json_io import (
    InterchangeError,
    dumps,
    fingerprint,
    loads,
    read,
)
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load_interlocking, raw


def export(
    plan: Path = typer.Argument(..., help="the scheme plan to export"),
    out: Path | None = typer.Option(None, "--out", "-o", help="write here instead of stdout"),
    stamp: bool = typer.Option(False, "--fingerprint", help="print the fingerprint and stop"),
) -> None:
    """Write the interlocking data as an interchange file."""
    scheme, interlocking = load_interlocking(plan)
    text = dumps(scheme, interlocking)

    if stamp:
        console.print(fingerprint(loads(text)))
        return

    if out is None:
        raw(text)
        return
    try:
        out.write_text(text, encoding="utf-8")
    except OSError as exc:
        fail(f"cannot write {out}: {exc.strerror}")
    console.print(f"wrote {out} ({len(text)} bytes, {fingerprint(loads(text))})")


def compare(
    before: Path = typer.Argument(..., help="the interchange file as signed off"),
    after: Path = typer.Argument(..., help="the interchange file now"),
    summary: bool = typer.Option(False, "--summary", help="print the counts only"),
    fmt: str = typer.Option("text", "--format", "-f", help="text or json"),
) -> None:
    """Compare two interchange files."""
    if fmt not in ("text", "json"):
        fail(f"no such format: {fmt}, try text or json")

    try:
        old = read(before)
        new = read(after)
    except InterchangeError as exc:
        fail(str(exc))

    result = compare_data(old, new)

    if fmt == "json":
        raw(result.json())
        raise typer.Exit(EXIT_OK if result.same else EXIT_FINDINGS)

    if not summary:
        for name in result.added:
            console.print(f"[green]added[/green] {name}", highlight=False)
        for name in result.removed:
            console.print(f"[red]removed[/red] {name}", highlight=False)
        for difference in result.changed:
            console.print(f"[yellow]{difference}[/yellow]", highlight=False)
    console.print(result.summary())
    raise typer.Exit(EXIT_OK if result.same else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(export)
    app.command()(compare)
