"""Running the checks and collecting what they found."""

from __future__ import annotations

from typing import Dict, Iterable, Iterator, List, Optional

from layover.report.render import Report
from layover.validate.checks import CHECKS, check_named, check_names
from layover.validate.finding import Finding, Severity

__all__ = ["Findings", "validate"]


class Findings:
    """Everything the checks noticed, in a fixed order."""

    def __init__(self, findings: Iterable[Finding] = ()) -> None:
        self._found: List[Finding] = sorted(findings, key=lambda finding: finding.sort_key())

    def __len__(self) -> int:
        return len(self._found)

    def __iter__(self) -> Iterator[Finding]:
        return iter(self._found)

    def __bool__(self) -> bool:
        return bool(self._found)

    def __getitem__(self, index):
        return self._found[index]

    @property
    def found(self) -> tuple[Finding, ...]:
        """Every finding, worst first."""
        return tuple(self._found)

    def of_severity(self, severity) -> tuple[Finding, ...]:
        """Only the findings of one severity."""
        wanted = Severity.parse(severity)
        return tuple(finding for finding in self._found if finding.severity is wanted)

    def of_check(self, check: str) -> tuple[Finding, ...]:
        """Only the findings one check made."""
        return tuple(finding for finding in self._found if finding.check == check)

    def checks_fired(self) -> tuple[str, ...]:
        """Which checks found something, sorted."""
        return tuple(sorted({finding.check for finding in self._found}))

    @property
    def errors(self) -> tuple[Finding, ...]:
        """Only the errors."""
        return self.of_severity(Severity.ERROR)

    @property
    def warnings(self) -> tuple[Finding, ...]:
        """Only the warnings."""
        return self.of_severity(Severity.WARNING)

    @property
    def notices(self) -> tuple[Finding, ...]:
        """Only the notices."""
        return self.of_severity(Severity.NOTICE)

    @property
    def clean(self) -> bool:
        """Whether nothing at all was found."""
        return not self._found

    @property
    def passed(self) -> bool:
        """Whether nothing serious was found."""
        return not self.errors

    def counts(self) -> Dict[str, int]:
        """How many findings there are of each severity."""
        counts = {severity.value: 0 for severity in Severity}
        for finding in self._found:
            counts[finding.severity.value] += 1
        return counts

    def messages(self) -> tuple[str, ...]:
        """Every finding as one line, worst first."""
        return tuple(finding.describe() for finding in self._found)

    def as_report(self, title: str = "Feed checks") -> Report:
        """The findings as a report, one row each."""
        rows = tuple(
            (str(finding.severity), finding.check, finding.subject, finding.message)
            for finding in self._found
        )
        counts = self.counts()
        notes = [
            "%d errors, %d warnings, %d notices."
            % (counts["error"], counts["warning"], counts["notice"])
        ]
        if self.clean:
            notes.append("Nothing to report.")
        return Report(title, ("Severity", "Check", "Subject", "Message"), rows, tuple(notes))

    def summary(self) -> str:
        """One line: how many of each severity."""
        counts = self.counts()
        return "%d errors, %d warnings, %d notices" % (
            counts["error"],
            counts["warning"],
            counts["notice"],
        )

    def __str__(self) -> str:
        return self.summary()


def validate(
    contents,
    only: Optional[Iterable[str]] = None,
    skip: Optional[Iterable[str]] = None,
) -> Findings:
    """Run the checks over a loaded feed and collect what they find.

    ``only`` names the checks to run and ``skip`` names the ones to leave out;
    an unknown name in either raises rather than being quietly ignored.
    """
    names = list(check_names())
    if only is not None:
        wanted = [str(name) for name in only]
        for name in wanted:
            check_named(name)
        names = [name for name in names if name in set(wanted)]
    if skip is not None:
        unwanted = [str(name) for name in skip]
        for name in unwanted:
            check_named(name)
        names = [name for name in names if name not in set(unwanted)]
    found: List[Finding] = []
    for name in names:
        found.extend(CHECKS[name](contents))
    return Findings(found)
