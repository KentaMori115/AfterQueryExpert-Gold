"""The check command and the rule listing that goes with it."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...interchange.findings import dumps as findings_json
from ...interchange.findings import read as read_findings
from ...interchange.findings import since
from ...verify import checks as _checks  # noqa: F401  (registers the rules)
from ...verify.guidance import guidance_for
from ...verify.report import Finding, Report, Severity
from ...verify.rules import Context, run
from ...verify.waivers import Waivers, read_waivers, write_waivers
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, load, plans_in, raw

#: The formats findings can come out in.
FORMATS = ("text", "json")

SEVERITY_COLOUR = {
    Severity.ERROR: "red",
    Severity.WARNING: "yellow",
    Severity.ADVICE: "cyan",
}


def _run_over(plans: list[Path], only: list[str] | None, skip: list[str] | None) -> Report:
    """Run the rules over every plan, naming the plan when there is more than one."""
    report = Report()
    many = len(plans) > 1

    for path in plans:
        context = Context.build(load(path))
        try:
            found = run(context, only=only or None, skip=skip or ())
        except KeyError as exc:
            fail(str(exc).strip("'"))
        report.extend(_named_after(found, path) if many else found)
        report.ran = found.ran

    return report


def _named_after(report: Report, path: Path) -> list[Finding]:
    """The same findings with the plan they came from in front of the subject."""
    return [
        Finding(
            finding.rule,
            finding.severity,
            f"{path.stem}:{finding.subject}",
            finding.message,
            finding.detail,
        )
        for finding in report
    ]


def _narrow(report: Report, accepted: Waivers | None, since_file: Path | None) -> Report:
    """Take out what has been accepted and what was already known about."""
    if accepted is not None:
        report = accepted.apply(report)
    if since_file is not None:
        try:
            report = since(report, read_findings(since_file))
        except SignalboxError as exc:
            fail(str(exc))
    return report


def _print_findings(report: Report, *, explain: bool) -> None:
    explained: set[str] = set()
    for finding in report.sorted():
        colour = SEVERITY_COLOUR[finding.severity]
        console.print(
            f"[{colour}]{finding.severity}[/{colour}] "
            f"{finding.rule} {finding.subject}: {finding.message}",
            highlight=False,
        )
        if not explain or finding.rule in explained:
            continue
        explained.add(finding.rule)
        advice = guidance_for(finding.rule)
        if advice is not None:
            console.print(f"       [dim]{advice.fix}[/dim]", highlight=False)


def _read_waivers(path: Path | None) -> Waivers | None:
    if path is None:
        return None
    try:
        return read_waivers(path)
    except SignalboxError as exc:
        fail(str(exc))


def check(
    plan: Path = typer.Argument(..., help="the scheme plan, or a directory of them"),
    only: list[str] | None = typer.Option(None, "--only", help="run just these rules"),
    skip: list[str] | None = typer.Option(None, "--skip", help="leave these rules out"),
    waivers: Path | None = typer.Option(
        None, "--waivers", help="a file of findings that have already been accepted"
    ),
    accept: bool = typer.Option(
        False, "--accept", help="print a waiver file that would accept everything found"
    ),
    explain: bool = typer.Option(
        False, "--explain", help="print why each rule is there and what to do"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="print the summary only"),
    fmt: str = typer.Option("text", "--format", "-f", help="text or json"),
    strict: bool = typer.Option(False, "--strict", help="treat warnings as errors as well"),
    since_file: Path | None = typer.Option(
        None, "--since", help="a findings file, to report only what is new since then"
    ),
) -> None:
    """Run the rules against a scheme and report what they find."""
    if fmt not in FORMATS:
        fail(f"no such format: {fmt}, try {' or '.join(sorted(FORMATS))}")

    report = _run_over(plans_in(plan), only, skip)

    if accept:
        raw(write_waivers(report))
        raise typer.Exit(EXIT_OK)

    accepted = _read_waivers(waivers)
    report = _narrow(report, accepted, since_file)
    passes = report.passes(Severity.WARNING if strict else Severity.ERROR)

    if fmt == "json":
        raw(findings_json(report, scheme=plan.stem, waivers=accepted, explain=explain))
        raise typer.Exit(EXIT_OK if passes else EXIT_FINDINGS)

    if not quiet:
        _print_findings(report, explain=explain)
    if accepted is not None:
        console.print(f"{len(accepted)} waivers applied")
    console.print(report.summary())
    if strict and report.ok and not passes:
        console.print("[yellow]warnings are errors with --strict[/yellow]")
    raise typer.Exit(EXIT_OK if passes else EXIT_FINDINGS)


def register(app: typer.Typer) -> None:
    app.command()(check)
