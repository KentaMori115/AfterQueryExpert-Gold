"""Public finding and source-reference types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping

__all__ = ["SEVERITY_RANK", "Finding", "Severity", "SourceRef", "sort_findings"]


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


SEVERITY_RANK: Mapping[Severity, int] = {
    Severity.ERROR: 0,
    Severity.WARNING: 1,
    Severity.INFO: 2,
}


@dataclass(frozen=True, slots=True)
class SourceRef:
    path: str
    line: int
    column: int

    def as_tuple(self) -> tuple[str, int, int]:
        return (self.path, self.line, self.column)


@dataclass(frozen=True, slots=True)
class Finding:
    code: str
    severity: Severity
    message: str
    subject_kind: str | None = None
    subject_id: str | None = None
    source: SourceRef | None = None
    witness: Mapping[str, str | int | bool] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        object.__setattr__(self, "witness", dict(self.witness) if self.witness is not None else {})

    def sort_key(self) -> tuple[object, ...]:
        src = self.source
        return (
            SEVERITY_RANK[self.severity],
            src.path if src is not None else "",
            src.line if src is not None else -1,
            src.column if src is not None else -1,
            self.code,
            self.subject_kind or "",
            self.subject_id or "",
            self.message,
        )


def sort_findings(findings: list[Finding] | tuple[Finding, ...]) -> tuple[Finding, ...]:
    """Return findings in the public stable order."""
    return tuple(sorted(findings, key=lambda item: item.sort_key()))
