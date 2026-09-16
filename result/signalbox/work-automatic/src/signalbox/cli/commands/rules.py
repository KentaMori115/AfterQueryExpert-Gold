"""The rules command: what check will run, and what each rule is for."""

from __future__ import annotations

import typer

from ...verify import checks as _checks  # noqa: F401  (registers the rules)
from ...verify.guidance import GUIDANCE, as_markdown, guidance_for
from ...verify.report import Severity
from ...verify.rules import registered
from ..common import console, fail, grid, raw

SEVERITY_COLOUR = {
    Severity.ERROR: "red",
    Severity.WARNING: "yellow",
    Severity.ADVICE: "cyan",
}


def rules(
    explain: str | None = typer.Option(
        None, "--explain", help="print the long form for one rule and stop"
    ),
    severity: str | None = typer.Option(
        None, "--severity", help="list only rules of this severity"
    ),
    everything: bool = typer.Option(False, "--all", help="print the long form for every rule"),
    markdown: bool = typer.Option(
        False, "--markdown", help="print the whole rule set as a document"
    ),
) -> None:
    """List the rules that check will run, or explain one of them."""
    if explain is not None:
        found = guidance_for(explain)
        if found is None:
            known = ", ".join(rule.code for rule in registered())
            fail(f"no rule called {explain}, try one of {known}")
        raw(found.text())
        return

    if markdown:
        raw(as_markdown())
        return

    if everything:
        raw("\n".join(GUIDANCE[rule.code].text() for rule in registered()))
        return

    chosen = registered()
    if severity is not None:
        wanted = {member.name.lower(): member for member in Severity}.get(severity.lower())
        if wanted is None:
            names = ", ".join(member.name.lower() for member in Severity)
            fail(f"no severity called {severity}, try one of {names}")
        chosen = [rule for rule in chosen if rule.severity is wanted]

    console.print(
        grid(
            "rules",
            ["code", "severity", "title"],
            [
                [
                    rule.code,
                    f"[{SEVERITY_COLOUR[rule.severity]}]{rule.severity}[/]",
                    rule.title,
                ]
                for rule in chosen
            ],
        )
    )
    console.print(f"{len(chosen)} of {len(registered())} rules")


def register(app: typer.Typer) -> None:
    app.command()(rules)
