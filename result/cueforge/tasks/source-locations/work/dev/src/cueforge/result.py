"""Typed result wrapper used by the public library API."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

from cueforge.findings import Finding, Severity, sort_findings

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class Result(Generic[T]):
    """A value plus findings. Errors make ``is_ok`` false even if a value is present."""

    value: T | None
    findings: tuple[Finding, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "findings", sort_findings(self.findings))

    @property
    def is_ok(self) -> bool:
        return self.value is not None and not any(
            finding.severity == Severity.ERROR for finding in self.findings
        )

    @property
    def errors(self) -> tuple[Finding, ...]:
        return tuple(f for f in self.findings if f.severity == Severity.ERROR)

    @classmethod
    def ok(cls, value: T, findings: tuple[Finding, ...] | list[Finding] = ()) -> Result[T]:
        return cls(value=value, findings=tuple(findings))

    @classmethod
    def fail(cls, findings: tuple[Finding, ...] | list[Finding]) -> Result[T]:
        return cls(value=None, findings=tuple(findings))
