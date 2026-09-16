"""Findings in a shape another program can read.

A build that runs ``check`` wants to do something with the answer: annotate a
pull request, raise a ticket, count what changed since last week. Parsing the
printed output for that is miserable, so the findings go out as JSON with the
same fields the printed form has.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..errors import SignalboxError
from ..verify.guidance import guidance_for
from ..verify.report import Finding, Report
from ..verify.waivers import Waivers

#: Bumped if the shape below changes in a way a reader would notice.
FINDINGS_VERSION = 1


class FindingsError(SignalboxError):
    """The file is not a findings file, or is one this version cannot read."""


def finding_as_dict(finding: Finding, *, explain: bool = False) -> dict[str, Any]:
    found: dict[str, Any] = {
        "rule": finding.rule,
        "severity": str(finding.severity),
        "subject": finding.subject,
        "message": finding.message,
        "detail": finding.detail,
    }
    if explain:
        guidance = guidance_for(finding.rule)
        if guidance is not None:
            found["why"] = guidance.why
            found["fix"] = guidance.fix
    return found


def as_dict(
    report: Report,
    *,
    scheme: str | None = None,
    waivers: Waivers | None = None,
    explain: bool = False,
) -> dict[str, Any]:
    """The whole report, ready to be written out."""
    counts = {
        str(severity): len(report.of(severity))
        for severity in sorted({finding.severity for finding in report}, key=lambda s: -s.value)
    }
    found: dict[str, Any] = {
        "findings_version": FINDINGS_VERSION,
        "scheme": scheme,
        "ok": report.ok,
        "rules_run": list(report.ran),
        "counts": counts,
        "findings": [finding_as_dict(finding, explain=explain) for finding in report.sorted()],
    }
    if waivers is not None:
        found["accepted"] = [finding_as_dict(finding) for finding in waivers.accepted(report)]
        found["waivers_unused"] = [
            {"rule": waiver.rule, "subject": waiver.subject}
            for waiver in waivers.unused(report)
        ]
    return found


def dumps(
    report: Report,
    *,
    scheme: str | None = None,
    waivers: Waivers | None = None,
    explain: bool = False,
) -> str:
    data = as_dict(report, scheme=scheme, waivers=waivers, explain=explain)
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def keys_in(data: dict[str, Any]) -> set[tuple[str, str]]:
    """The rule and subject of every finding in a written report."""
    found: set[tuple[str, str]] = set()
    for finding in data.get("findings", ()):
        rule = finding.get("rule")
        subject = finding.get("subject")
        if isinstance(rule, str) and isinstance(subject, str):
            found.add((rule, subject))
    return found


def loads(text: str) -> dict[str, Any]:
    """Read a findings file back, checking it is one."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FindingsError(f"not valid JSON: {exc.msg} at line {exc.lineno}") from None
    if not isinstance(data, dict) or "findings" not in data:
        raise FindingsError("no findings in the file, this is not a findings file")
    version = data.get("findings_version")
    if version is not None and version > FINDINGS_VERSION:
        raise FindingsError(
            f"written by a later version (findings {version}, "
            f"this reads {FINDINGS_VERSION})"
        )
    return data


def read(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    try:
        return loads(source.read_text(encoding="utf-8"))
    except OSError as exc:
        raise FindingsError(f"cannot read {source}: {exc.strerror}") from None


def since(report: Report, baseline: dict[str, Any]) -> Report:
    """The findings that are not in a report written earlier."""
    known = keys_in(baseline)
    return Report(
        findings=[finding for finding in report if finding.key not in known],
        ran=report.ran,
    )
