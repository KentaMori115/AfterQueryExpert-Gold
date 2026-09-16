"""Turning an approved plan plus a shot draft into a timed storyboard.

Only the visual treatment comes from the model. Timing is computed here, and
voiceover, overlay text and fact references are copied from the plan, so a
storyboard can never say something the planner did not already justify.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import ValidationError

from maingott_reel.creative.draft import StoryboardDraft
from maingott_reel.errors import PlanRejectedError
from maingott_reel.models import (
    AssetRequirement,
    AssetType,
    GenerationProvenance,
    Language,
    Scene,
    SceneTransition,
    ScriptBeat,
    ScriptPlan,
    Storyboard,
    ValidationReport,
)
from maingott_reel.utils.hashing import sha256_text

#: A generated clip shorter than this is not worth a scene of its own.
MIN_SCENE_SECONDS = 2.0

#: Upper bound for one generated clip.
MAX_SCENE_SECONDS = 12.0


def distribute_durations(beats: list[ScriptBeat], target_seconds: int) -> list[float]:
    """Spread ``target_seconds`` across beats in proportion to their estimates.

    The last scene absorbs the rounding remainder so the timeline lands exactly
    on the target duration.

    Raises:
        PlanRejectedError: the beats carry no duration to scale.
    """
    total = sum(beat.estimated_seconds for beat in beats)
    if total <= 0:
        raise PlanRejectedError("The plan's beats have no duration to distribute.")

    durations = [round(beat.estimated_seconds * target_seconds / total, 2) for beat in beats]
    durations[-1] = round(target_seconds - sum(durations[:-1]), 2)
    if durations[-1] <= 0:
        raise PlanRejectedError(
            "The plan's beat durations cannot be scaled onto the target duration."
        )
    return durations


def build_scenes(plan: ScriptPlan, draft: StoryboardDraft, target_seconds: int) -> list[Scene]:
    """Combine the plan and the shot draft into timed scenes.

    Raises:
        PlanRejectedError: the draft does not cover the plan's beats exactly,
            or a scene does not satisfy the schema.
    """
    shots = {shot.beat_id: shot for shot in draft.shots}
    if len(shots) != len(draft.shots):
        raise PlanRejectedError("The model returned more than one shot for the same beat.")

    missing = [beat.id for beat in plan.beats if beat.id not in shots]
    if missing:
        raise PlanRejectedError(f"The model returned no shot for: {', '.join(missing)}")
    extra = [beat_id for beat_id in shots if beat_id not in {beat.id for beat in plan.beats}]
    if extra:
        raise PlanRejectedError(f"The model invented beats that are not in the plan: {extra}")

    durations = distribute_durations(plan.beats, target_seconds)
    scenes: list[Scene] = []
    start = 0.0
    for position, (beat, duration) in enumerate(zip(plan.beats, durations, strict=True), start=1):
        shot = shots[beat.id]
        try:
            scenes.append(
                Scene(
                    id=f"S-{position:02d}",
                    beat_id=beat.id,
                    start_seconds=round(start, 2),
                    duration_seconds=duration,
                    purpose=beat.purpose,
                    visual_description=shot.visual_description,
                    video_prompt=shot.video_prompt,
                    voiceover=beat.narration,
                    overlay_text=beat.on_screen_text,
                    source_fact_ids=list(beat.source_fact_ids),
                    asset_requirements=[
                        AssetRequirement(
                            asset_type=AssetType.VIDEO,
                            prompt=shot.video_prompt,
                            duration_seconds=duration,
                            notes="silent footage; captions and logo are added in post-production",
                        )
                    ],
                    transition=SceneTransition(shot.transition),
                )
            )
        except (ValidationError, ValueError) as error:
            raise PlanRejectedError(f"The shot for beat {beat.id} is malformed: {error}") from error
        start = round(start + duration, 2)
    return scenes


def build_storyboard(
    scenes: list[Scene],
    plan: ScriptPlan,
    target_seconds: int,
    language: Language,
    validation: ValidationReport,
    provenance: GenerationProvenance,
    created_at: datetime | None = None,
) -> Storyboard:
    """Assemble the persisted storyboard.

    Raises:
        PlanRejectedError: the assembled storyboard violates the schema.
    """
    fact_ids: list[str] = []
    for scene in scenes:
        for fact_id in scene.source_fact_ids:
            if fact_id not in fact_ids:
                fact_ids.append(fact_id)
    try:
        return Storyboard(
            created_at=created_at or datetime.now(tz=UTC),
            language=language,
            target_duration_seconds=target_seconds,
            total_duration_seconds=round(sum(scene.duration_seconds for scene in scenes), 2),
            narration_sha256=sha256_text(plan.narration),
            scenes=scenes,
            source_fact_ids=fact_ids,
            validation=validation,
            provenance=provenance,
        )
    except ValidationError as error:
        raise PlanRejectedError(f"The assembled storyboard is invalid: {error}") from error


def render_beats(plan: ScriptPlan, target_seconds: int) -> str:
    """Render the plan's beats as the prompt's BEATS block."""
    durations = distribute_durations(plan.beats, target_seconds)
    lines = []
    for beat, duration in zip(plan.beats, durations, strict=True):
        caption = beat.on_screen_text or "—"
        lines.append(
            f"{beat.id} [{beat.kind.value}] {duration}s\n"
            f"  purpose: {beat.purpose}\n"
            f"  narration: {beat.narration}\n"
            f"  caption: {caption}"
        )
    return "\n".join(lines)
