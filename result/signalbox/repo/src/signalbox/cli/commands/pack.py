"""The pack command: everything a stage handover needs, in one directory."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...interchange.csv_io import write_all
from ...interchange.findings import dumps as findings_json
from ...interchange.json_io import dumps, fingerprint, loads
from ...interchange.report import write_report
from ...render.geometry import place
from ...render.svg import render_svg
from ...verify import checks as _checks  # noqa: F401  (registers the rules)
from ...verify.report import Severity
from ...verify.rules import Context, run
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load_interlocking


def pack(
    plan: Path = typer.Argument(..., help="the scheme plan to pack up"),
    out: Path = typer.Option(Path("pack"), "--out", "-o", help="directory to write into"),
    strict: bool = typer.Option(
        False, "--strict", help="refuse to write anything if the rules find an error"
    ),
    warnings_too: bool = typer.Option(
        False, "--warnings-too", help="with --strict, count warnings as errors"
    ),
) -> None:
    """Write the interchange file, the tables, the drawing and the check report.

    This is what gets handed over: one directory, one fingerprint, and a report
    saying what was known to be wrong with it at the time.
    """
    scheme, interlocking = load_interlocking(plan)

    report = run(Context(scheme=scheme, interlocking=interlocking))
    bar = Severity.WARNING if warnings_too else Severity.ERROR
    passes = report.passes(bar)
    if strict and not passes:
        found = len(report.at_least(bar))
        fail(f"{found} findings at {bar} or worse, nothing written")

    try:
        out.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        fail(f"cannot make {out}: {exc.strerror}")

    written: list[Path] = []
    try:
        data = dumps(scheme, interlocking)
        stamp = fingerprint(loads(data))
        written.append(_write(out / f"{scheme.name}.sbj", data))
        written.extend(write_all(out, scheme, interlocking))
        written.append(_write(out / f"{scheme.name}.svg", render_svg(scheme, place(scheme))))
        written.append(_write(out / "check.txt", report.text()))
        written.append(
            _write(
                out / "check.json",
                findings_json(report, scheme=scheme.name, explain=True),
            )
        )
        written.append(_write(out / "report.txt", write_report(scheme, interlocking, report)))
        written.append(_write(out / "fingerprint.txt", f"{stamp}\n{scheme.describe()}\n"))
    except (SignalboxError, OSError) as exc:
        fail(str(exc))

    for path in written:
        console.print(f"wrote {path}")
    console.print(f"{len(written)} files, fingerprint {stamp}")
    console.print(report.summary())
    raise typer.Exit(EXIT_OK if passes else EXIT_FINDINGS)


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def register(app: typer.Typer) -> None:
    app.command()(pack)
