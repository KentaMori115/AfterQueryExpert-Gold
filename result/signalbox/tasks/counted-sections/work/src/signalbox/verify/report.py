"""What the rules produce and how it is summed up.

A finding names the rule that raised it and the thing it is about, so that the
same finding produced on two different days can be compared. That matters more
than the wording: a scheme is signed off against a list of accepted findings,
and the list has to be stable.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from enum import Enum


class Severity(Enum):
    """How much attention a finding demands, worst first."""

    ERROR = 3
    WARNING = 2
    ADVICE = 1

    @property
    def blocks_approval(self) -> bool:
        return self is Severity.ERROR

    def __str__(self) -> str:
        return self.name.lower()


@dataclass(frozen=True)
class Finding:
    """One objection, from one rule, about one thing."""

    rule: str
    severity: Severity
    subject: str
    message: str
    detail: str = ""

    @property
    def key(self) -> tuple[str, str]:
        """What identifies this finding across runs."""
        return (self.rule, self.subject)

    def __str__(self) -> str:
        tail = f" ({self.detail})" if self.detail else ""
        return f"{self.severity} {self.rule} {self.subject}: {self.message}{tail}"


@dataclass
class Report:
    """Every finding from one run of the rules."""

    findings: list[Finding] = field(default_factory=list)
    ran: tuple[str, ...] = ()

    def __len__(self) -> int:
        return len(self.findings)

    def __iter__(self) -> Iterator[Finding]:
        return iter(self.findings)

    def __bool__(self) -> bool:
        return bool(self.findings)

    @property
    def ok(self) -> bool:
        """True when nothing found would stop the scheme being approved."""
        return not self.errors()

    @property
    def clean(self) -> bool:
        return not self.findings

    def errors(self) -> list[Finding]:
        return self.of(Severity.ERROR)

    def warnings(self) -> list[Finding]:
        return self.of(Severity.WARNING)

    def advice(self) -> list[Finding]:
        return self.of(Severity.ADVICE)

    def of(self, severity: Severity) -> list[Finding]:
        return [finding for finding in self.findings if finding.severity is severity]

    def by_rule(self, rule: str) -> list[Finding]:
        return [finding for finding in self.findings if finding.rule == rule]

    def about(self, subject: str) -> list[Finding]:
        return [finding for finding in self.findings if finding.subject == subject]

    def worst(self) -> Severity | None:
        if not self.findings:
            return None
        return max((finding.severity for finding in self.findings), key=lambda s: s.value)

    def keys(self) -> set[tuple[str, str]]:
        return {finding.key for finding in self.findings}

    def extend(self, more: Iterable[Finding]) -> None:
        self.findings.extend(more)

    def at_least(self, severity: Severity) -> list[Finding]:
        """Findings this bad or worse."""
        return [
            finding for finding in self.findings if finding.severity.value >= severity.value
        ]

    def passes(self, severity: Severity = Severity.ERROR) -> bool:
        """Whether the report is clean enough to accept at this bar."""
        return not self.at_least(severity)

    def deduplicated(self) -> Report:
        """The same report with repeated rule and subject pairs taken out.

        Two rules can find the same thing from different directions, and a
        report that says it twice is a report somebody stops reading.
        """
        seen: set[tuple[str, str]] = set()
        kept: list[Finding] = []
        for finding in self.sorted():
            if finding.key in seen:
                continue
            seen.add(finding.key)
            kept.append(finding)
        return Report(findings=kept, ran=self.ran)

    def sorted(self) -> list[Finding]:
        return sorted(self.findings, key=lambda f: (-f.severity.value, f.rule, f.subject))

    def summary(self) -> str:
        if not self.findings:
            return f"{len(self.ran)} rules ran, nothing found"
        counts = [
            f"{len(self.of(severity))} {severity}" for severity in Severity if self.of(severity)
        ]
        return f"{len(self.ran)} rules ran, " + ", ".join(counts)

    def text(self) -> str:
        lines = [str(finding) for finding in self.sorted()]
        lines.append(self.summary())
        return "\n".join(lines) + "\n"
