"""Turning a model draft into the strict Phase 2 artifacts.

The provider returns a permissive :class:`CreativePlanDraft`. This module
converts it into a :class:`CreativeBrief` and the beats of a
:class:`ScriptPlan`, assigning stable ids and deriving every field that must
not be left to the model (narration text, fact id lists, totals).

A draft that cannot be converted is a malformed plan, not something to patch
up: conversion raises :class:`PlanRejectedError` with the validation detail.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import ValidationError

from maingott_reel.creative.draft import CreativePlanDraft
from maingott_reel.errors import PlanRejectedError
from maingott_reel.models import (
    BeatKind,
    ClaimKind,
    ClaimReference,
    CreativeBrief,
    GenerationProvenance,
    Language,
    ScriptBeat,
    ScriptPlan,
    ValidationReport,
)

#: Restrictions recorded on every brief, from the claims policy.
STANDARD_RESTRICTIONS = (
    "no team members",
    "no invented customers or case studies",
    "no invented metrics or performance results",
    "design targets must not be presented as achieved results",
    "every factual claim cites source fact ids",
)


def build_brief(
    draft: CreativePlanDraft,
    target_duration_seconds: int,
    language: Language,
    aspect_ratio: str,
) -> CreativeBrief:
    """Convert the draft brief into the strict model.

    Raises:
        PlanRejectedError: the draft brief does not satisfy the schema.
    """
    restrictions = list(dict.fromkeys([*STANDARD_RESTRICTIONS, *draft.brief.restrictions]))
    try:
        return CreativeBrief(
            objective=draft.brief.objective,
            audience=draft.brief.audience,
            aspect_ratio=aspect_ratio,
            target_duration_seconds=target_duration_seconds,
            language=language,
            tone=draft.brief.tone,
            visual_direction=draft.brief.visual_direction,
            core_message=draft.brief.core_message,
            supporting_messages=list(draft.brief.supporting_messages),
            cta=draft.brief.cta,
            restrictions=restrictions,
            source_fact_ids=list(dict.fromkeys(draft.brief.source_fact_ids)),
        )
    except ValidationError as error:
        raise PlanRejectedError(f"The model's creative brief is malformed: {error}") from error


def build_beats(draft: CreativePlanDraft) -> list[ScriptBeat]:
    """Convert draft beats into strict beats with stable ids.

    Beats are renumbered in the order the model gave them, so ids are stable
    for a given draft and independent of the model's own numbering.

    Raises:
        PlanRejectedError: a beat does not satisfy the schema.
    """
    ordered = sorted(draft.beats, key=lambda beat: beat.order)
    beats: list[ScriptBeat] = []
    for position, beat in enumerate(ordered, start=1):
        try:
            beats.append(
                ScriptBeat(
                    id=f"B-{position:02d}",
                    order=position,
                    kind=BeatKind(beat.kind),
                    purpose=beat.purpose,
                    narration=beat.narration,
                    on_screen_text=beat.on_screen_text,
                    visual_direction=beat.visual_direction,
                    estimated_seconds=round(beat.estimated_seconds, 2),
                    claims=[
                        ClaimReference(
                            claim=claim.claim,
                            kind=ClaimKind(claim.kind),
                            source_fact_ids=list(dict.fromkeys(claim.source_fact_ids)),
                        )
                        for claim in beat.claims
                    ],
                )
            )
        except (ValidationError, ValueError) as error:
            raise PlanRejectedError(
                f"Beat {position} of the model's plan is malformed: {error}"
            ) from error
    if not beats:
        raise PlanRejectedError("The model returned a plan without beats.")
    return beats


def build_plan(
    beats: list[ScriptBeat],
    target_duration_seconds: int,
    language: Language,
    validation: ValidationReport,
    provenance: GenerationProvenance,
    created_at: datetime | None = None,
) -> ScriptPlan:
    """Assemble the persisted script plan from validated beats.

    Every derived field is computed here rather than taken from the model, so
    the artifact is internally consistent by construction.

    Raises:
        PlanRejectedError: the assembled plan violates the schema.
    """
    claims = [claim for beat in beats for claim in beat.claims]
    fact_ids: list[str] = []
    for beat in beats:
        for fact_id in beat.source_fact_ids:
            if fact_id not in fact_ids:
                fact_ids.append(fact_id)
    try:
        return ScriptPlan(
            created_at=created_at or datetime.now(tz=UTC),
            language=language,
            target_duration_seconds=target_duration_seconds,
            total_estimated_seconds=round(sum(beat.estimated_seconds for beat in beats), 2),
            narration="\n".join(beat.narration for beat in beats),
            beats=beats,
            source_fact_ids=fact_ids,
            claims=claims,
            validation=validation,
            provenance=provenance,
        )
    except ValidationError as error:
        raise PlanRejectedError(f"The assembled script plan is invalid: {error}") from error
