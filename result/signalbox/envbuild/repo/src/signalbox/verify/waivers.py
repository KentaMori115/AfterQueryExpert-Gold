"""Findings somebody has looked at and accepted, with the reason why.

No scheme of any size is clean. What matters is that every finding has either
been fixed or been accepted by somebody who wrote down why, and that a finding
nobody has seen before stands out. That is what a waiver file is: a list of
findings that are known about, so that ``check`` can say what is new.

    # accepted at the design review, 12 February
    flank-open K3(MA)       the branch is worked one engine in steam
    overlap-short K3(MB)    platform is too short for a full overlap
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..errors import SignalboxError
from .report import Finding, Report


class WaiverError(SignalboxError):
    """The waiver file could not be read."""


@dataclass(frozen=True)
class Waiver:
    """One accepted finding."""

    rule: str
    subject: str
    reason: str = ""

    @property
    def key(self) -> tuple[str, str]:
        return (self.rule, self.subject)

    def covers(self, finding: Finding) -> bool:
        return finding.key == self.key

    def __str__(self) -> str:
        tail = f"  {self.reason}" if self.reason else ""
        return f"{self.rule} {self.subject}{tail}"


@dataclass
class Waivers:
    """Every accepted finding, and what is left once they are taken out."""

    waivers: list[Waiver] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.waivers)

    def __iter__(self) -> Iterator[Waiver]:
        return iter(self.waivers)

    def covers(self, finding: Finding) -> Waiver | None:
        for waiver in self.waivers:
            if waiver.covers(finding):
                return waiver
        return None

    def apply(self, report: Report) -> Report:
        """The report with the accepted findings taken out."""
        kept = [finding for finding in report if self.covers(finding) is None]
        return Report(findings=kept, ran=report.ran)

    def accepted(self, report: Report) -> list[Finding]:
        return [finding for finding in report if self.covers(finding) is not None]

    def unused(self, report: Report) -> list[Waiver]:
        """Waivers for findings the rules no longer make, which can be deleted."""
        keys = report.keys()
        return [waiver for waiver in self.waivers if waiver.key not in keys]

    def summary(self, report: Report) -> str:
        return (
            f"{len(self.accepted(report))} of {len(report)} findings accepted, "
            f"{len(self.unused(report))} waivers no longer needed"
        )


def parse_waivers(text: str, *, source: str = "<string>") -> Waivers:
    """Read a waiver file: one finding to a line, comments after a hash."""
    found: list[Waiver] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split(None, 2)
        if len(parts) < 2:
            raise WaiverError(f"{source}:{number}: expected a rule and a subject")
        rule, subject = parts[0], parts[1]
        reason = parts[2].strip() if len(parts) > 2 else ""
        found.append(Waiver(rule, subject, reason))
    return Waivers(found)


def read_waivers(path: str | Path) -> Waivers:
    plan = Path(path)
    try:
        text = plan.read_text(encoding="utf-8")
    except OSError as exc:
        raise WaiverError(f"cannot read {plan}: {exc.strerror}") from None
    return parse_waivers(text, source=str(plan))


def write_waivers(report: Report, *, reason: str = "") -> str:
    """A waiver file that would accept everything in a report."""
    lines = ["# written by signalbox, one finding to a line"]
    for finding in report.sorted():
        tail = f"  {reason}" if reason else f"  {finding.message}"
        lines.append(f"{finding.rule} {finding.subject}{tail}")
    return "\n".join(lines) + "\n"
