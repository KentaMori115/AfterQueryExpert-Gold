"""The ``storyboard`` stage.

Consumes the approved script plan and produces the timed scene list the asset
and composition stages will execute. The model contributes only the visual
treatment: everything the viewer hears or reads is carried over from the plan,
and the result is validated deterministically before it is written.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.creative.claims import failure_feedback, validate_storyboard
from maingott_reel.creative.draft import StoryboardDraft
from maingott_reel.creative.storyboard_generator import (
    build_scenes,
    build_storyboard,
    render_beats,
)
from maingott_reel.errors import PlanRejectedError, ProviderError, StageNotCompletedError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    STORYBOARD_VERSION,
    FactRegistry,
    GenerationProvenance,
    Scene,
    ScriptPlan,
    StageName,
    Storyboard,
    ValidationReport,
)
from maingott_reel.providers.base import TextProvider
from maingott_reel.providers.fake import OfflineStoryboardProvider
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.prompts import PromptTemplate, load_prompt
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("creative.storyboarder")

SYSTEM_PROMPT = "system/visual_director"
USER_PROMPT = "creative/storyboard"

_LANGUAGE_NAMES = {"ru": "Russian", "en": "English"}


@dataclass(frozen=True)
class StoryboardResult:
    """What the ``storyboard`` stage produced."""

    run: RunContext
    storyboard: Storyboard
    plan: ScriptPlan
    reused: bool

    @property
    def attempts(self) -> int:
        """How many generation attempts the accepted storyboard needed."""
        return self.storyboard.provenance.attempts


@dataclass(frozen=True)
class _Generated:
    """One accepted generation attempt."""

    scenes: list[Scene]
    report: ValidationReport
    system_prompt: PromptTemplate
    user_prompt: PromptTemplate
    input_tokens: int | None
    output_tokens: int | None
    attempts: int


def _load_plan(run: RunContext) -> ScriptPlan:
    """Load the approved plan of a run.

    Raises:
        StageNotCompletedError: the run has no usable plan.
    """
    run.require(run.script_json, "plan")
    try:
        plan = read_model(run.script_json, ScriptPlan)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"script.json in run {run.run_id} is unreadable ({error}). Re-run 'plan'."
        ) from error
    if not plan.passed:
        raise StageNotCompletedError(
            f"The plan in run {run.run_id} did not pass validation. Re-run 'plan'."
        )
    return plan


def _check_plan_is_current(
    settings: Settings, run: RunContext, plan: ScriptPlan, source_path: Path | None
) -> None:
    """Fail when the plan no longer matches the run's facts or source.

    Raises:
        StageNotCompletedError: the plan is stale.
    """
    run.require(run.facts_json, "analyze")
    try:
        registry = read_model(run.facts_json, FactRegistry)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"facts.json in run {run.run_id} is unreadable ({error}). Re-run 'analyze'."
        ) from error

    if plan.provenance.source_sha256 != registry.source_sha256:
        raise StageNotCompletedError(
            f"The plan in run {run.run_id} was made from different facts. Re-run 'plan'."
        )
    path = source_path or settings.source_document
    if path.is_file() and sha256_file(path) != registry.source_sha256:
        raise StageNotCompletedError(
            f"{path.name} changed since the analysis of run {run.run_id}. Re-run 'analyze'."
        )


def _reusable(run: RunContext, narration_sha256: str) -> Storyboard | None:
    """Return an existing storyboard when it belongs to this plan."""
    if not run.storyboard_json.is_file():
        return None
    try:
        storyboard = read_model(run.storyboard_json, Storyboard)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning(
            "existing storyboard is unreadable, regenerating", extra={"error": str(error)}
        )
        return None
    if storyboard.narration_sha256 != narration_sha256:
        return None
    return storyboard


def _guard_existing_storyboard(run: RunContext, narration_sha256: str, force: bool) -> None:
    """Refuse to overwrite a storyboard built from a different plan.

    Raises:
        PlanRejectedError: a storyboard from another plan would be lost.
    """
    if force or not run.storyboard_json.is_file():
        return
    try:
        existing = read_model(run.storyboard_json, Storyboard)
    except (ValidationError, orjson.JSONDecodeError, OSError):
        return
    if existing.narration_sha256 != narration_sha256:
        raise PlanRejectedError(
            f"Run {run.run_id} already holds a storyboard built from a different plan "
            f"({existing.narration_sha256[:12]}…). Use --force or a new run."
        )


def _render_prompts(
    settings: Settings, plan: ScriptPlan, target_seconds: int, feedback: str
) -> tuple[PromptTemplate, str, PromptTemplate, str]:
    """Render the system and user prompts for one attempt."""
    system = load_prompt(SYSTEM_PROMPT, settings.prompts_root)
    user = load_prompt(USER_PROMPT, settings.prompts_root)
    rendered_user = user.render(
        duration_seconds=target_seconds,
        scene_count=len(plan.beats),
        language=_LANGUAGE_NAMES.get(plan.language.value, plan.language.value),
        beats=render_beats(plan, target_seconds),
        feedback=f"\nPREVIOUS ATTEMPT REJECTED BY VALIDATION\n{feedback}" if feedback else "",
    )
    return system, system.render(), user, rendered_user


def _default_provider(settings: Settings, plan: ScriptPlan, dry_run: bool) -> TextProvider:
    """Return the provider to use when the caller did not supply one."""
    if dry_run:
        return OfflineStoryboardProvider(plan)
    from maingott_reel.providers.openai_provider import OpenAITextProvider

    provider: TextProvider = OpenAITextProvider(settings)
    return provider


def storyboard(
    settings: Settings,
    run_id: str | None = None,
    duration: int | None = None,
    provider: TextProvider | None = None,
    dry_run: bool = False,
    force: bool = False,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> StoryboardResult:
    """Run the storyboard stage.

    Args:
        settings: effective configuration.
        run_id: run to work in. Defaults to the most recent run.
        duration: target duration. Defaults to the plan's target.
        provider: text provider to use. Defaults to OpenAI, or the offline
            shot provider when ``dry_run`` is set.
        dry_run: build the storyboard without calling a model.
        force: rebuild even if this run already holds a storyboard.
        source_path: overrides ``settings.source_document`` for staleness checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has no current, valid plan.
        PlanRejectedError: no attempt produced a storyboard that validates.
        ProviderError: the text provider failed.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    plan = _load_plan(run)
    _check_plan_is_current(settings, run, plan, source_path)
    target_seconds = settings.resolve_duration(duration or plan.target_duration_seconds)
    narration_sha256 = sha256_text(plan.narration)

    if not force:
        existing = _reusable(run, narration_sha256)
        if existing is not None and existing.target_duration_seconds == target_seconds:
            logger.info(
                "storyboard reused",
                extra={"run_id": run.run_id, "scenes": existing.scene_count},
            )
            return StoryboardResult(run=run, storyboard=existing, plan=plan, reused=True)
    _guard_existing_storyboard(run, narration_sha256, force)

    text_provider = provider or _default_provider(settings, plan, dry_run)
    generated = _generate(
        settings=settings,
        plan=plan,
        provider=text_provider,
        target_seconds=target_seconds,
    )

    provenance = GenerationProvenance(
        generator_version=STORYBOARD_VERSION,
        prompt_version=f"{generated.system_prompt.version}/{generated.user_prompt.version}",
        system_prompt_sha256=generated.system_prompt.sha256,
        user_prompt_sha256=generated.user_prompt.sha256,
        provider=text_provider.name,
        model=text_provider.model,
        generated_at=datetime.now(tz=UTC),
        source_sha256=plan.provenance.source_sha256,
        offered_fact_ids=list(plan.source_fact_ids),
        attempts=generated.attempts,
        input_tokens=generated.input_tokens,
        output_tokens=generated.output_tokens,
        target_facts_allowed=plan.provenance.target_facts_allowed,
    )
    board = build_storyboard(
        scenes=generated.scenes,
        plan=plan,
        target_seconds=target_seconds,
        language=plan.language,
        validation=generated.report,
        provenance=provenance,
    )

    write_model(run.storyboard_json, board)
    _record_stage(run, board, provenance)

    logger.info(
        "storyboard complete",
        extra={
            "run_id": run.run_id,
            "scenes": board.scene_count,
            "seconds": board.total_duration_seconds,
            "attempts": generated.attempts,
            "model": provenance.model,
        },
    )
    return StoryboardResult(run=run, storyboard=board, plan=plan, reused=False)


def _generate(
    settings: Settings,
    plan: ScriptPlan,
    provider: TextProvider,
    target_seconds: int,
) -> _Generated:
    """Generate until a storyboard passes validation, or give up.

    Raises:
        PlanRejectedError: every attempt failed validation or conversion.
    """
    feedback = ""
    last_error = "no attempt was made"
    for attempt in range(1, settings.planner_max_attempts + 1):
        system, system_text, user, user_text = _render_prompts(
            settings, plan, target_seconds, feedback
        )
        result = provider.generate_structured(
            system_prompt=system_text,
            user_prompt=user_text,
            schema=StoryboardDraft,
        )
        draft = result.value
        if not isinstance(draft, StoryboardDraft):
            raise ProviderError(
                f"The provider returned {type(draft).__name__}, expected StoryboardDraft"
            )

        try:
            scenes = build_scenes(plan, draft, target_seconds)
        except PlanRejectedError as error:
            last_error = str(error)
            feedback = last_error
            logger.warning(
                "storyboard draft malformed", extra={"attempt": attempt, "error": last_error}
            )
            continue

        report = validate_storyboard(scenes, plan, target_seconds)
        if report.passed:
            return _Generated(
                scenes=scenes,
                report=report,
                system_prompt=system,
                user_prompt=user,
                input_tokens=result.usage.input_tokens,
                output_tokens=result.usage.output_tokens,
                attempts=attempt,
            )

        feedback = failure_feedback(report)
        last_error = feedback
        logger.warning(
            "storyboard rejected by validation",
            extra={
                "attempt": attempt,
                "failed_checks": [check.name for check in report.failures],
            },
        )

    raise PlanRejectedError(
        f"No valid storyboard after {settings.planner_max_attempts} attempts. Last failures:\n"
        f"{last_error}"
    )


def _record_stage(run: RunContext, board: Storyboard, provenance: GenerationProvenance) -> None:
    """Write the storyboard's provenance into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.models.text = provenance.model
    manifest.files["storyboard"] = run.storyboard_json
    manifest.record_stage(
        StageName.STORYBOARD,
        completed_at=provenance.generated_at,
        artifact=run.storyboard_json,
        notes=(
            f"{board.scene_count} scenes, {board.total_duration_seconds}s, "
            f"{len(board.asset_requirements())} assets required, validation passed"
        ),
    )
    save_manifest(run, manifest)
