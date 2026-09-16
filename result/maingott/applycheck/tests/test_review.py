"""The human review checklist."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import ApprovalError
from maingott_reel.models import ReviewChecklist, ReviewItem
from maingott_reel.release import review as review_store
from maingott_reel.release.inputs import fingerprint, load_inputs
from maingott_reel.utils.jsonio import read_model
from maingott_reel.utils.run_context import RunContext

FINAL = "a" * 64


def test_a_new_checklist_starts_with_nothing_confirmed():
    checklist = review_store.new_checklist("run-1", FINAL)

    assert len(checklist.items) == len(review_store.REVIEW_QUESTIONS)
    assert not checklist.complete
    assert len(checklist.outstanding) == len(checklist.items)
    assert "0/13" in checklist.summary()


def test_the_checklist_covers_what_a_machine_cannot_judge():
    ids = set(review_store.item_ids())
    for expected in (
        "visual_quality",
        "no_generation_artifacts",
        "captions_readable",
        "logo_correct",
        "logo_contrast",
        "narration_natural",
        "narration_pronunciation",
        "narration_language",
        "music_acceptable",
        "transitions_acceptable",
        "brand_presentation",
        "marketing_message",
        "approved_for_release",
    ):
        assert expected in ids


def test_confirming_records_who_did_it():
    checklist = review_store.new_checklist("run-1", FINAL)

    updated = review_store.confirm(
        checklist, ["visual_quality"], reviewer="Reviewer", note="Looked at on a phone."
    )

    item = updated.get("visual_quality")
    assert item is not None and item.confirmed
    assert item.confirmed_by == "Reviewer"
    assert item.confirmed_at is not None
    assert item.note == "Looked at on a phone."
    assert not updated.complete


def test_confirming_every_item_completes_the_review():
    checklist = review_store.new_checklist("run-1", FINAL)
    updated = review_store.confirm(checklist, review_store.item_ids(), reviewer="Reviewer")
    assert updated.complete
    assert updated.sha256


def test_a_confirmation_has_to_name_somebody():
    checklist = review_store.new_checklist("run-1", FINAL)
    with pytest.raises(ApprovalError, match="who made it"):
        review_store.confirm(checklist, ["visual_quality"], reviewer="  ")


def test_an_unknown_item_is_refused():
    checklist = review_store.new_checklist("run-1", FINAL)
    with pytest.raises(ApprovalError, match="unknown review item"):
        review_store.confirm(checklist, ["looks_cool"], reviewer="Reviewer")


def test_nothing_can_confirm_an_item_without_a_reviewer():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="by nobody"):
        ReviewItem(id="x", question="Is it good?", confirmed=True)


def test_item_ids_are_unique():
    from pydantic import ValidationError

    item = ReviewItem(id="same", question="Is it good?")
    with pytest.raises(ValidationError, match="unique"):
        ReviewChecklist(
            run_id="run-1",
            final_sha256=FINAL,
            created_at=datetime(2026, 8, 20, tzinfo=UTC),
            items=[item, item],
        )


# --- against a run -----------------------------------------------------------------


def test_a_checklist_is_created_for_the_current_reel(
    production_settings: Settings, production_run: RunContext
):
    identity = fingerprint(production_settings, load_inputs(production_run))

    checklist, restarted = review_store.current_checklist(production_run, identity.final_sha256)

    assert not restarted
    assert checklist.final_sha256 == identity.final_sha256
    review_store.save_checklist(production_run, checklist)
    assert read_model(production_run.review_json, ReviewChecklist).run_id == production_run.run_id


def test_a_review_of_the_same_reel_is_carried_forward(
    production_settings: Settings, production_run: RunContext
):
    identity = fingerprint(production_settings, load_inputs(production_run))
    checklist, _ = review_store.current_checklist(production_run, identity.final_sha256)
    checklist = review_store.confirm(checklist, ["visual_quality"], reviewer="Reviewer")
    review_store.save_checklist(production_run, checklist)

    again, restarted = review_store.current_checklist(production_run, identity.final_sha256)

    assert not restarted
    item = again.get("visual_quality")
    assert item is not None and item.confirmed


def test_a_recomposed_reel_starts_the_review_again(
    production_settings: Settings, production_run: RunContext
):
    identity = fingerprint(production_settings, load_inputs(production_run))
    checklist, _ = review_store.current_checklist(production_run, identity.final_sha256)
    checklist = review_store.confirm(checklist, review_store.item_ids(), reviewer="Reviewer")
    review_store.save_checklist(production_run, checklist)

    fresh, restarted = review_store.current_checklist(production_run, "b" * 64)

    assert restarted
    assert not fresh.complete


def test_an_unreadable_checklist_is_treated_as_absent(production_run: RunContext):
    production_run.review_json.write_text("{not json", encoding="utf-8")
    assert review_store.load_checklist(production_run) is None
