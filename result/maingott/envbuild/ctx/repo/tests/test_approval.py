"""Human approval, and what invalidates it."""

from __future__ import annotations

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import ApprovalError
from maingott_reel.models import (
    ApprovalRecord,
    ApprovalStatus,
    ArtifactFingerprint,
    Composition,
    ReleaseState,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.release import approval as approval_store
from maingott_reel.release import review as review_store
from maingott_reel.release.checker import release_check
from maingott_reel.release.inputs import fingerprint, load_inputs
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext


def _fingerprint(settings: Settings, run: RunContext) -> ArtifactFingerprint:
    return fingerprint(settings, load_inputs(run))


def _approve(settings: Settings, run: RunContext, **overrides: object) -> ApprovalRecord:
    fields = {
        "run": run,
        "fingerprint": _fingerprint(settings, run),
        "approved_by": "Release Manager",
        "release_version": "v1.0.0",
        "review": review_store.load_checklist(run),
    }
    fields.update(overrides)
    return approval_store.create(**fields)


# --- creating an approval ---------------------------------------------------


def test_an_approval_is_bound_to_the_exact_file(
    production_settings: Settings, reviewed_run: RunContext
):
    record = _approve(production_settings, reviewed_run)

    identity = _fingerprint(production_settings, reviewed_run)
    assert record.final_sha256 == identity.final_sha256
    assert record.covers(identity)
    assert record.approves
    assert record.approved_by == "Release Manager"
    assert reviewed_run.approval_json.is_file()
    assert read_model(reviewed_run.approval_json, ApprovalRecord).sha256 == record.sha256


def test_an_approval_has_to_name_somebody(production_settings: Settings, reviewed_run: RunContext):
    with pytest.raises(ApprovalError, match="who made it"):
        _approve(production_settings, reviewed_run, approved_by="   ")


def test_the_release_version_has_to_be_well_formed(
    production_settings: Settings, reviewed_run: RunContext
):
    with pytest.raises(ApprovalError, match="release version"):
        _approve(production_settings, reviewed_run, release_version="1.0")


def test_approval_without_a_completed_review_is_refused(
    production_settings: Settings, production_run: RunContext
):
    with pytest.raises(ApprovalError, match="no human review"):
        _approve(production_settings, production_run, review=None)


def test_approval_with_an_unfinished_review_is_refused(
    production_settings: Settings, production_run: RunContext
):
    identity = _fingerprint(production_settings, production_run)
    checklist, _ = review_store.current_checklist(production_run, identity.final_sha256)
    checklist = review_store.confirm(checklist, ["visual_quality"], reviewer="Reviewer")
    review_store.save_checklist(production_run, checklist)

    with pytest.raises(ApprovalError, match="not complete"):
        _approve(production_settings, production_run, review=checklist)


def test_approval_with_a_review_of_another_reel_is_refused(
    production_settings: Settings, reviewed_run: RunContext
):
    checklist = review_store.load_checklist(reviewed_run)
    assert checklist is not None
    stale = checklist.model_copy(update={"final_sha256": "c" * 64})

    with pytest.raises(ApprovalError, match="different Reel"):
        _approve(production_settings, reviewed_run, review=stale)


def test_a_rejection_needs_no_review(production_settings: Settings, production_run: RunContext):
    record = _approve(
        production_settings,
        production_run,
        review=None,
        status=ApprovalStatus.REJECTED,
        notes="The footage is wrong.",
    )
    assert not record.approves
    assert record.status is ApprovalStatus.REJECTED


# --- what invalidates it ------------------------------------------------------


def test_an_untouched_approval_stays_valid(production_settings: Settings, approved_run: RunContext):
    approval = approval_store.load_approval(approved_run)
    valid, reason, differences = approval_store.verify(
        approval, _fingerprint(production_settings, approved_run)
    )
    assert valid, reason
    assert not differences


def test_changing_the_final_file_invalidates_the_approval(
    production_settings: Settings, approved_run: RunContext
):
    composition = read_model(approved_run.composition_json, Composition)
    assert composition.output_path is not None
    composition.output_path.write_bytes(composition.output_path.read_bytes() + b"\x00")

    approval = approval_store.load_approval(approved_run)
    valid, reason, differences = approval_store.verify(
        approval, _fingerprint(production_settings, approved_run)
    )
    assert not valid
    assert "different content" in reason
    assert differences == ["final_sha256"]


def test_changing_the_storyboard_invalidates_the_approval(
    production_settings: Settings, approved_run: RunContext
):
    board = read_model(approved_run.storyboard_json, Storyboard)
    write_model(approved_run.storyboard_json, board.model_copy(update={"version": "9.9"}))

    approval = approval_store.load_approval(approved_run)
    valid, _, differences = approval_store.verify(
        approval, _fingerprint(production_settings, approved_run)
    )
    assert not valid
    assert "storyboard_sha256" in differences


def test_changing_the_narration_track_invalidates_the_approval(
    production_settings: Settings, approved_run: RunContext
):
    composition = read_model(approved_run.composition_json, Composition)
    updated = composition.model_copy(
        update={"audio": composition.audio.model_copy(update={"voice_sha256": "d" * 64})}
    )
    write_model(approved_run.composition_json, updated)

    approval = approval_store.load_approval(approved_run)
    valid, _, differences = approval_store.verify(
        approval, _fingerprint(production_settings, approved_run)
    )
    assert not valid
    assert "voice_sha256" in differences


def test_changing_the_production_configuration_invalidates_the_approval(
    production_settings: Settings, approved_run: RunContext
):
    changed = production_settings.model_copy(update={"video_crf": 28})

    approval = approval_store.load_approval(approved_run)
    valid, _, differences = approval_store.verify(approval, _fingerprint(changed, approved_run))
    assert not valid
    assert "configuration_sha256" in differences


def test_an_unrelated_setting_does_not_invalidate_the_approval(
    production_settings: Settings, approved_run: RunContext
):
    noisy = production_settings.model_copy(update={"log_level": "DEBUG"})

    approval = approval_store.load_approval(approved_run)
    valid, reason, _ = approval_store.verify(approval, _fingerprint(noisy, approved_run))
    assert valid, reason


def test_a_rejection_never_counts_as_an_approval(
    production_settings: Settings, production_run: RunContext
):
    record = _approve(
        production_settings, production_run, review=None, status=ApprovalStatus.REJECTED
    )
    valid, reason, _ = approval_store.verify(
        record, _fingerprint(production_settings, production_run)
    )
    assert not valid
    assert "rejected" in reason


def test_a_missing_approval_is_not_an_approval(
    production_settings: Settings, production_run: RunContext
):
    valid, reason, _ = approval_store.verify(
        None, _fingerprint(production_settings, production_run)
    )
    assert not valid
    assert "no approval" in reason


def test_requiring_a_valid_approval_explains_the_refusal(
    production_settings: Settings, approved_run: RunContext
):
    voice = read_model(approved_run.voice_json, VoiceAsset)
    write_model(approved_run.voice_json, voice.model_copy(update={"voice": "cedar"}))
    approval = approval_store.load_approval(approved_run)

    # The voice record changed but the audio did not, so the approval stands.
    approval_store.require_valid(approval, _fingerprint(production_settings, approved_run))

    composition = read_model(approved_run.composition_json, Composition)
    assert composition.output_path is not None
    composition.output_path.write_bytes(b"tampered")
    with pytest.raises(ApprovalError, match="final_sha256"):
        approval_store.require_valid(approval, _fingerprint(production_settings, approved_run))


def test_an_unreadable_approval_is_treated_as_absent(approved_run: RunContext):
    approved_run.approval_json.write_text("{not json", encoding="utf-8")
    assert approval_store.load_approval(approved_run) is None


def test_release_check_reports_an_approved_run_as_approved(
    production_settings: Settings, approved_run: RunContext
):
    result = release_check(production_settings, run_id=approved_run.run_id)
    assert result.state is ReleaseState.APPROVED
    assert result.is_release_candidate
