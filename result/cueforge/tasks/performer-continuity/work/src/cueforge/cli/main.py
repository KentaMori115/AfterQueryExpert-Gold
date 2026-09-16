"""CueForge command-line entry point."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import typer

from cueforge.cli.commands import (
    cmd_compile,
    cmd_rehearse,
    cmd_report,
    cmd_runs_inspect,
    cmd_sheet,
)

app = typer.Typer(
    name="cueforge",
    add_completion=False,
    no_args_is_help=True,
    help="Deterministic cue compiler and rehearsal simulator.",
)


def _write_stdout(text: str) -> None:
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except BrokenPipeError:  # pragma: no cover
        raise SystemExit(0) from None


@app.command("compile")
def compile_cmd(
    production: Path = typer.Argument(..., exists=True, readable=True),
    format: str = typer.Option("text", "--format", help="text or json"),
) -> None:
    """Validate and compile a production file or workspace."""
    if format not in {"text", "json"}:
        typer.echo("error: --format must be text or json", err=True)
        raise typer.Exit(code=2)
    text, code = cmd_compile(production, format)
    _write_stdout(text)
    raise typer.Exit(code=code)


@app.command("rehearse")
def rehearse_cmd(
    production: Path = typer.Argument(..., exists=True, readable=True),
    format: str = typer.Option("text", "--format", help="text, json, or ndjson"),
    delay: list[str] = typer.Option([], "--delay", help="CUE=2500ms"),
    fail: list[str] = typer.Option([], "--fail", help="cue id to fail at start"),
) -> None:
    """Run a deterministic virtual-time rehearsal."""
    if format not in {"text", "json", "ndjson"}:
        typer.echo("error: --format must be text, json, or ndjson", err=True)
        raise typer.Exit(code=2)
    try:
        text, code = cmd_rehearse(production, format, delay, fail)
    except ValueError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=2) from exc
    _write_stdout(text)
    raise typer.Exit(code=code)


@app.command("sheet")
def sheet_cmd(
    production: Path = typer.Argument(..., exists=True, readable=True),
    department: Optional[str] = typer.Option(None, "--department"),
    output: Optional[Path] = typer.Option(None, "--output"),
) -> None:
    """Export a master or departmental cue sheet as canonical JSON."""
    text, code = cmd_sheet(production, department, output)
    if text:
        _write_stdout(text)
    raise typer.Exit(code=code)


@app.command("report")
def report_cmd(
    production: Path = typer.Argument(..., exists=True, readable=True),
    format: str = typer.Option("json", "--format", help="json or text"),
) -> None:
    """Compile and rehearse, then emit a report."""
    if format not in {"text", "json"}:
        typer.echo("error: --format must be text or json", err=True)
        raise typer.Exit(code=2)
    text, code = cmd_report(production, format)
    _write_stdout(text)
    raise typer.Exit(code=code)


@app.command("runs")
def runs_cmd(
    action: str = typer.Argument(..., help="inspect"),
    production: Path = typer.Argument(..., exists=True, readable=True),
    digest: Optional[str] = typer.Option(None, "--digest"),
) -> None:
    """Inspect a stored run digest."""
    if action != "inspect":
        typer.echo("error: runs action must be inspect", err=True)
        raise typer.Exit(code=2)
    if not digest:
        typer.echo("error: --digest is required", err=True)
        raise typer.Exit(code=2)
    text, code = cmd_runs_inspect(production, digest)
    _write_stdout(text)
    raise typer.Exit(code=code)


if __name__ == "__main__":
    app()
