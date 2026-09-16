"""The human review checklist.

Automated gates establish that a Reel is technically correct and that every
claim traces back to the specification. They cannot establish that the footage
looks right, that the narration sounds like a person, or that the whole thing
says what the business wants said. Those are the items here, and nothing in
this project may tick them.

A checklist belongs to one exact Reel. Re-compose and it is a different Reel,
so the review starts again.
"""

from __future__ import annotations

from datetime import UTC, datetime

import orjson
from pydantic import ValidationError

from maingott_reel.errors import ApprovalError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import ReviewChecklist, ReviewItem
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext

logger = get_logger("release.review")

#: What a human has to look at, and say out loud, before a Reel is published.
REVIEW_QUESTIONS: tuple[tuple[str, str, str], ...] = (
    ("visual_quality", "visual", "Is the generated footage good enough to publish?"),
    ("no_generation_artifacts", "visual", "Is the footage free of obvious generation artifacts?"),
    ("captions_readable", "visual", "Are the captions readable on a phone, in motion?"),
    ("logo_correct", "brand", "Is the brand mark the correct, current MainGott logo?"),
    ("logo_contrast", "brand", "Does the brand mark read clearly against the footage behind it?"),
    ("narration_natural", "audio", "Does the narration sound like a person, not a machine?"),
    ("narration_pronunciation", "audio", "Is every product and brand name pronounced correctly?"),
    ("narration_language", "audio", "Is the narration in the language this Reel should be in?"),
    ("music_acceptable", "audio", "Is the music bed (or its absence) right for this Reel?"),
    ("transitions_acceptable", "visual", "Do the transitions and pacing work?"),
    ("brand_presentation", "brand", "Is MainGott presented the way the brand requires?"),
    ("marketing_message", "message", "Does the Reel say what the business wants said?"),
    ("approved_for_release", "message", "Taken as a whole, is this Reel fit to publish?"),
)


def new_checklist(
    run_id: str, final_sha256: str, created_at: datetime | None = None
) -> ReviewChecklist:
    """Build an empty checklist for one exact Reel."""
    moment = created_at or datetime.now(tz=UTC)
    return ReviewChecklist(
        run_id=run_id,
        final_sha256=final_sha256,
        created_at=moment,
        items=[
            ReviewItem(id=item_id, category=category, question=question)
            for item_id, category, question in REVIEW_QUESTIONS
        ],
    )


def load_checklist(run: RunContext) -> ReviewChecklist | None:
    """Load this run's review, or ``None`` when there is none."""
    if not run.review_json.is_file():
        return None
    try:
        return read_model(run.review_json, ReviewChecklist)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("the review checklist is unreadable", extra={"error": str(error)})
        return None


def current_checklist(run: RunContext, final_sha256: str) -> tuple[ReviewChecklist, bool]:
    """Return the checklist for this exact Reel, and whether it was restarted.

    A checklist recorded against a different file described a different Reel,
    so it is replaced rather than carried over.
    """
    existing = load_checklist(run)
    if existing is not None and existing.final_sha256 == final_sha256:
        return existing, False
    if existing is not None:
        logger.info(
            "the Reel changed since it was reviewed; the review starts again",
            extra={"run_id": run.run_id},
        )
    return new_checklist(run.run_id, final_sha256), existing is not None


def confirm(
    checklist: ReviewChecklist,
    item_ids: list[str],
    reviewer: str,
    note: str | None = None,
    at: datetime | None = None,
) -> ReviewChecklist:
    """Record that a human confirmed one or more items.

    Raises:
        ApprovalError: an unknown item was named, or no reviewer was given.
    """
    if not reviewer.strip():
        raise ApprovalError("a review confirmation has to say who made it")
    unknown = [item_id for item_id in item_ids if checklist.get(item_id) is None]
    if unknown:
        known = ", ".join(item.id for item in checklist.items)
        raise ApprovalError(f"unknown review item(s): {', '.join(unknown)}. Known items: {known}")

    moment = at or datetime.now(tz=UTC)
    wanted = set(item_ids)
    items = [
        item.model_copy(
            update={
                "confirmed": True,
                "confirmed_by": reviewer.strip(),
                "confirmed_at": moment,
                "note": note or item.note,
            }
        )
        if item.id in wanted
        else item
        for item in checklist.items
    ]
    return checklist.model_copy(update={"items": items, "updated_at": moment})


def save_checklist(run: RunContext, checklist: ReviewChecklist) -> ReviewChecklist:
    """Persist the checklist into the run directory."""
    write_model(run.review_json, checklist)
    return checklist


def item_ids() -> list[str]:
    """Every review item id, in order."""
    return [item_id for item_id, _, _ in REVIEW_QUESTIONS]
