"""Validation results shared by every stage that checks its own output."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from maingott_reel.models.base import SCHEMA_VERSION, Schema


class ValidationCheck(Schema):
    """Result of a single quality gate."""

    name: str = Field(min_length=1)
    passed: bool
    detail: str | None = None


class ValidationReport(Schema):
    """Outcome of every quality gate for one artifact."""

    schema_version: int = SCHEMA_VERSION
    created_at: datetime
    checks: list[ValidationCheck] = Field(default_factory=list)

    @property
    def passed(self) -> bool:
        """An artifact is accepted only when every check passes."""
        return bool(self.checks) and all(check.passed for check in self.checks)

    @property
    def failures(self) -> list[ValidationCheck]:
        """Checks that did not pass."""
        return [check for check in self.checks if not check.passed]

    def failure_summary(self) -> str:
        """One line naming what failed."""
        return "; ".join(f"{check.name}: {check.detail}" for check in self.failures)
