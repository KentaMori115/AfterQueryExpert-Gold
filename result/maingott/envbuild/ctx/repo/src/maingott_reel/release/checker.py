"""The ``release-check`` stage.

Runs the Phase 6 audit, then asks the production-readiness questions that
audit deliberately does not: is this real footage, a real and approved voice,
an approved brand mark, a complete pipeline run?

Three outcomes, and the difference matters:

``PASS``
    a release candidate — a human may now review and approve it;
``BLOCKED``
    a valid Reel built from something nobody approved. Not a defect, and not
    releasable either;
``FAIL``
    not a valid Reel at all: a blocking quality gate failed.

Nothing here approves anything, and nothing here publishes anything.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.assets.probe import MediaProbe
from maingott_reel.audit.auditor import audit as run_audit
from maingott_reel.config import Settings
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    ApprovalRecord,
    ArtifactFingerprint,
    BrandRegistry,
    QualityGate,
    QualityReport,
    ReleaseOutcome,
    ReleaseState,
    ReviewChecklist,
    VoiceProfile,
)
from maingott_reel.release import approval as approval_store
from maingott_reel.release.brand import load_registry, load_voice_profile
from maingott_reel.release.configuration import snapshot
from maingott_reel.release.inputs import ReleaseInputs, fingerprint, load_inputs
from maingott_reel.release.policy import production_gates
from maingott_reel.release.review import load_checklist
from maingott_reel.utils.jsonio import write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("release.check")


@dataclass(frozen=True)
class ReleaseCheckResult:
    """What ``release-check`` found."""

    run: RunContext
    inputs: ReleaseInputs
    audit: QualityReport
    report: QualityReport
    fingerprint: ArtifactFingerprint
    registry: BrandRegistry | None
    profile: VoiceProfile | None
    review: ReviewChecklist | None
    approval: ApprovalRecord | None

    @property
    def blocking(self) -> list[QualityGate]:
        """Release gates that must pass and did not."""
        return self.report.blocking_failures

    @property
    def advisory(self) -> list[QualityGate]:
        """Release gates that are reported without blocking candidacy."""
        return self.report.warnings

    @property
    def outcome(self) -> ReleaseOutcome:
        """The verdict."""
        if not self.audit.passed:
            return ReleaseOutcome.FAIL
        return ReleaseOutcome.PASS if not self.blocking else ReleaseOutcome.BLOCKED

    @property
    def is_release_candidate(self) -> bool:
        """Whether a human may now review and approve this Reel."""
        return self.outcome is ReleaseOutcome.PASS

    @property
    def state(self) -> ReleaseState:
        """Where this run stands."""
        if self.approval is not None and self.approval.covers(self.fingerprint):
            return ReleaseState.APPROVED if self.approval.approves else ReleaseState.REJECTED
        if not self.audit.passed:
            return ReleaseState.DRAFT
        return (
            ReleaseState.RELEASE_CANDIDATE if self.is_release_candidate else ReleaseState.VALIDATED
        )

    def summary(self) -> str:
        """One line a human can act on."""
        passed = sum(1 for gate in self.report.gates if gate.passed)
        return (
            f"{self.outcome.value.upper()}: {passed}/{len(self.report.gates)} release gates "
            f"passed, state {self.state.value}"
        )


def release_check(
    settings: Settings,
    run_id: str | None = None,
    probe: MediaProbe | None = None,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> ReleaseCheckResult:
    """Decide whether a finished run is a release candidate.

    Makes no provider call and changes no generated artifact. The sanitized
    configuration snapshot is written into the run, because a release has to
    record what produced it.

    Args:
        settings: effective configuration.
        run_id: run to check. Defaults to the most recent run.
        probe: media inspector, passed through to the audit.
        source_path: overrides ``settings.source_document`` for drift checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has not been composed yet.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    # The audit is authoritative about the file itself; run it, never restate it.
    audit_result = run_audit(settings, run_id=run.run_id, probe=probe, source_path=source_path)
    inputs = load_inputs(run)
    identity = fingerprint(settings, inputs)

    write_model(run.configuration_json, snapshot(settings))
    inputs = load_inputs(run)  # pick up the snapshot we just wrote

    registry = load_registry(settings)
    profile = load_voice_profile(settings)
    review = load_checklist(run)
    approval = approval_store.load_approval(run)

    gates = production_gates(
        settings=settings,
        inputs=inputs,
        audit=audit_result.report,
        registry=registry,
        profile=profile,
        fingerprint=identity,
        review=review,
        approval=approval,
    )
    report = QualityReport(created_at=datetime.now(tz=UTC), run_id=run.run_id, gates=gates)
    result = ReleaseCheckResult(
        run=run,
        inputs=inputs,
        audit=audit_result.report,
        report=report,
        fingerprint=identity,
        registry=registry,
        profile=profile,
        review=review,
        approval=approval,
    )
    _record_state(run, result)

    logger.info(
        "release check complete",
        extra={
            "run_id": run.run_id,
            "outcome": result.outcome.value,
            "state": result.state.value,
            "blocking": len(result.blocking),
            "release_id": identity.release_id,
        },
    )
    return result


def _record_state(run: RunContext, result: ReleaseCheckResult) -> None:
    """Record where this run stands in the manifest."""
    manifest = load_or_create_manifest(run)
    manifest.release_state = result.state
    manifest.files["configuration"] = run.configuration_json
    save_manifest(run, manifest)
