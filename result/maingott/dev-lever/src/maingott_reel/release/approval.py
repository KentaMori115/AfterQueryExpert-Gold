"""Human approval.

An approval is one person saying "these exact bytes may be published". It is
recorded against the whole content fingerprint — the specification, the
script, the storyboard, the footage, the narration, the composition, the
finished file and the production configuration — so it stops describing
reality the moment any of them changes.

Nothing here approves anything on its own. ``approve`` requires a release
candidate and a completed human review, and refuses otherwise.
"""

from __future__ import annotations

from datetime import UTC, datetime

import orjson
from pydantic import ValidationError

from maingott_reel.errors import ApprovalError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    ApprovalRecord,
    ApprovalStatus,
    ArtifactFingerprint,
    ReviewChecklist,
    is_release_version,
)
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext

logger = get_logger("release.approval")


def load_approval(run: RunContext) -> ApprovalRecord | None:
    """Load this run's approval, or ``None`` when there is none."""
    if not run.approval_json.is_file():
        return None
    try:
        return read_model(run.approval_json, ApprovalRecord)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("the approval record is unreadable", extra={"error": str(error)})
        return None


def verify(
    approval: ApprovalRecord | None, fingerprint: ArtifactFingerprint
) -> tuple[bool, str, list[str]]:
    """Check an approval against the content in front of us.

    Returns whether it is valid, why not if it is not, and which parts of the
    fingerprint changed.
    """
    if approval is None:
        return False, "no approval has been recorded for this run", []
    if not approval.approves:
        return False, f"this Reel was rejected by {approval.approved_by}", []
    differences = approval.fingerprint.differences(fingerprint)
    if differences:
        return (
            False,
            "the approval describes different content; re-approve the current Reel",
            differences,
        )
    return True, f"approved by {approval.approved_by} as {approval.release_version}", []


def create(
    run: RunContext,
    fingerprint: ArtifactFingerprint,
    approved_by: str,
    release_version: str,
    review: ReviewChecklist | None = None,
    notes: str | None = None,
    status: ApprovalStatus = ApprovalStatus.APPROVED,
    at: datetime | None = None,
) -> ApprovalRecord:
    """Record a human decision about these exact bytes.

    Raises:
        ApprovalError: the decision is not attributable, the version is
            malformed, or an approval is being recorded without a completed
            review of this exact Reel.
    """
    if not approved_by.strip():
        raise ApprovalError("an approval has to say who made it: pass --by")
    if not is_release_version(release_version):
        raise ApprovalError(
            f"'{release_version}' is not a release version. Use vMAJOR.MINOR.PATCH, e.g. v1.0.0."
        )
    if status is ApprovalStatus.APPROVED:
        if review is None:
            raise ApprovalError(
                "no human review exists for this Reel. Run 'review' and confirm every item "
                "before approving."
            )
        if review.final_sha256 != fingerprint.final_sha256:
            raise ApprovalError(
                "the human review describes a different Reel. Review the current one before "
                "approving it."
            )
        if not review.complete:
            outstanding = ", ".join(item.id for item in review.outstanding)
            raise ApprovalError(
                f"the human review is not complete: {outstanding}. "
                "Every item has to be confirmed by a person before approval."
            )

    record = ApprovalRecord(
        run_id=run.run_id,
        release_version=release_version,
        status=status,
        approved_by=approved_by.strip(),
        approved_at=at or datetime.now(tz=UTC),
        notes=notes,
        fingerprint=fingerprint,
        review_sha256=review.sha256 if review is not None else None,
    )
    write_model(run.approval_json, record)
    logger.info(
        "approval recorded",
        extra={
            "run_id": run.run_id,
            "status": status.value,
            "release_version": release_version,
            "final_sha256": fingerprint.final_sha256[:12],
            "release_id": fingerprint.release_id,
        },
    )
    return record


def require_valid(
    approval: ApprovalRecord | None, fingerprint: ArtifactFingerprint
) -> ApprovalRecord:
    """Return the approval, or explain why it cannot be used.

    Raises:
        ApprovalError: there is no usable approval for this content.
    """
    valid, reason, differences = verify(approval, fingerprint)
    if not valid:
        detail = f" (changed: {', '.join(differences)})" if differences else ""
        raise ApprovalError(f"{reason}{detail}.")
    assert approval is not None  # narrowed by verify
    return approval
