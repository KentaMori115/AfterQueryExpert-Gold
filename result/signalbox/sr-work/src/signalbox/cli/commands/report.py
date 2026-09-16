"""The report command: the written summary of a scheme."""

from __future__ import annotations

from pathlib import Path

import typer

from ...interchange.report import write_report
from ...verify import checks as _checks  # noqa: F401  (registers the rules)
from ...verify.rules import Context, run
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load_interlocking, raw


def report(
    plan: Path = typer.Argument(..., help="the scheme plan to report on"),
    out: Path | None = typer.Option(None, "--out", "-o", help="write here instead of stdout"),
    findings: bool = typer.Option(
        True, "--findings/--no-findings", help="run the rules and include what they say"
    ),
) -> None:
    """Write the design report for a scheme."""
    scheme, interlocking = load_interlocking(plan)

    found = None
    if findings:
        found = run(Context(scheme=scheme, interlocking=interlocking))

    text = write_report(scheme, interlocking, found)

    if out is None:
        raw(text)
    else:
        try:
            out.write_text(text, encoding="utf-8")
        except OSError as exc:
            fail(f"cannot write {out}: {exc.strerror}")
        console.print(f"wrote {out} ({len(text)} bytes)")

    raise typer.Exit(EXIT_OK if found is None or found.ok else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(report)
