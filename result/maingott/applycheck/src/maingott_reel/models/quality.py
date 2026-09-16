"""The final quality report.

Phase 6 audits a finished run rather than any single artifact: the chain from
the source specification to the file on disk. Gates are grouped so a failure
says *what kind* of problem it is, and separated by severity so an advisory
note never masquerades as a blocking defect.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from maingott_reel.models.base import SCHEMA_VERSION, Schema

#: Bumped when the gates change in a way that alters what "valid" means.
QUALITY_VERSION = "1.0"


class GateGroup(StrEnum):
    """What part of the run a gate examines."""

    RUN = "run"
    """The artifacts exist, agree with each other and have not drifted."""

    CLAIMS = "claims"
    """What the Reel says is backed by the specification."""

    VOICE = "voice"
    """The narration track speaks the approved script and nothing else."""

    FILE = "file"
    """The finished file is the media it claims to be."""

    PRESENTATION = "presentation"
    """Captions, safe areas and branding."""

    READINESS = "readiness"
    """What separates this Reel from a publishable one."""

    RELEASE = "release"
    """Production readiness: may these exact bytes be released?"""


class GateSeverity(StrEnum):
    """How much a failure matters."""

    ERROR = "error"
    """The Reel is not valid. Blocks acceptance."""

    WARNING = "warning"
    """Worth a human's attention; does not block on its own."""


class QualityGate(Schema):
    """One check against a finished run."""

    name: str = Field(min_length=1)
    group: GateGroup
    passed: bool
    severity: GateSeverity = GateSeverity.ERROR
    detail: str | None = None

    @property
    def blocking(self) -> bool:
        """Whether this failure stops the Reel being accepted."""
        return not self.passed and self.severity is GateSeverity.ERROR


class QualityReport(Schema):
    """The outcome of every gate for one run."""

    schema_version: int = SCHEMA_VERSION
    version: str = QUALITY_VERSION
    created_at: datetime
    run_id: str = Field(min_length=1)
    gates: list[QualityGate] = Field(default_factory=list)

    @property
    def passed(self) -> bool:
        """Whether every blocking gate passed."""
        return bool(self.gates) and not any(gate.blocking for gate in self.gates)

    @property
    def failures(self) -> list[QualityGate]:
        """Every gate that did not pass, blocking or not."""
        return [gate for gate in self.gates if not gate.passed]

    @property
    def blocking_failures(self) -> list[QualityGate]:
        """Failures that stop the Reel being accepted."""
        return [gate for gate in self.gates if gate.blocking]

    @property
    def warnings(self) -> list[QualityGate]:
        """Failures that only ask for a human's attention."""
        return [
            gate for gate in self.gates if not gate.passed and gate.severity is GateSeverity.WARNING
        ]

    @property
    def production_ready(self) -> bool:
        """Whether the Reel passed everything, including readiness."""
        return self.passed and not self.failures

    def by_group(self, group: GateGroup) -> list[QualityGate]:
        """Every gate in one group."""
        return [gate for gate in self.gates if gate.group is group]

    def summary(self) -> str:
        """One line for logs and the manifest."""
        return (
            f"{sum(1 for gate in self.gates if gate.passed)}/{len(self.gates)} gates passed, "
            f"{len(self.blocking_failures)} blocking, {len(self.warnings)} warnings"
        )
