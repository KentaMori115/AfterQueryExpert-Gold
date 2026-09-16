"""What a check reports: a severity, a message, and what it is about.

A finding is not an exception. A feed with fifty warnings still loads and still
plans journeys; the point of the checks is to say what will surprise a passenger
later, not to refuse to work.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from layover.errors import LayoverError, Location

__all__ = ["Finding", "Severity"]


class Severity(Enum):
    """How much a finding matters."""

    ERROR = "error"
    WARNING = "warning"
    NOTICE = "notice"

    @property
    def rank(self) -> int:
        """Where the severity sorts, errors first."""
        return {"error": 0, "warning": 1, "notice": 2}[self.value]

    @classmethod
    def parse(cls, text) -> "Severity":
        """Read a severity from its name."""
        if isinstance(text, Severity):
            return text
        cleaned = str(text).strip().lower()
        for severity in cls:
            if severity.value == cleaned:
                return severity
        raise LayoverError("no such severity: %r" % (text,))

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Finding:
    """One thing a check noticed."""

    check: str
    severity: Severity
    message: str
    subject: str = ""
    where: Optional[Location] = None

    def __post_init__(self) -> None:
        check = str(self.check).strip()
        if not check:
            raise LayoverError("a finding has to say which check made it")
        object.__setattr__(self, "check", check)
        object.__setattr__(self, "severity", Severity.parse(self.severity))
        message = str(self.message).strip()
        if not message:
            raise LayoverError("a finding needs a message")
        object.__setattr__(self, "message", message)
        object.__setattr__(self, "subject", str(self.subject).strip())

    @property
    def is_error(self) -> bool:
        """Whether the finding is serious enough to stop a release."""
        return self.severity is Severity.ERROR

    def sort_key(self) -> tuple:
        """The order findings are listed in: worst first, then by check."""
        return (self.severity.rank, self.check, self.subject, self.message)

    def describe(self) -> str:
        """One line: severity, check, subject and message."""
        subject = " %s:" % self.subject if self.subject else ""
        return "%s [%s]%s %s" % (self.severity, self.check, subject, self.message)

    def __str__(self) -> str:
        return self.describe()
