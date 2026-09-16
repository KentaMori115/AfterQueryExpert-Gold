"""The ``plan`` stage.

Consumes the Phase 1 fact registry — never the specification itself — and
produces a validated creative brief and script plan.

The flow is: select facts, render versioned prompts, ask a text provider for a
structured draft, convert it into strict models, and validate it
deterministically against the fact registry. A plan that fails validation is
retried with the failures fed back to the model, and rejected outright if it
still fails. Nothing is repaired silently.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.creative.claims import ClaimPolicy, failure_feedback, validate_plan
from maingott_reel.creative.draft import CreativePlanDraft
from maingott_reel.creative.fact_selection import FactSelection, select_facts
from maingott_reel.creative.script_generator import build_beats, build_brief, build_plan
from maingott_reel.errors import PlanRejectedError, ProviderError, StageNotCompletedError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    PLANNER_VERSION,
    CreativeBrief,
    FactRegistry,
    GenerationProvenance,
    Language,
    ScriptBeat,
    ScriptPlan,
    StageName,
    ValidationReport,
)
from maingott_reel.providers.base import TextProvider
from maingott_reel.providers.fake import OfflinePlanProvider
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_manifest, load_or_create_manifest, save_manifest
from maingott_reel.utils.prompts import PromptTemplate, load_prompt
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("creative.planner")

SYSTEM_PROMPT = "system/creative_planner"
USER_PROMPT = "creative/plan"

_LANGUAGE_NAMES = {Language.RU: "Russian", Language.EN: "English"}

_TARGET_POLICY_EXCLUDED = (
    "No design targets, KPIs or acceptance thresholds are included in the FACTS "
    "block. Do not state response times, percentages, volumes or any other "
    "numeric performance value."
)
_TARGET_POLICY_ALLOWED = (
    "Facts marked [TARGET] are design goals, not achievements. If you use one, "
    "set the claim kind to `target` and word it so a listener hears intent — "
    "for example 'the platform is designed to ...'. Never say a target is "
    "already reached."
)


@dataclass(frozen=True)
class _Generated:
    """One accepted generation attempt."""

    brief: CreativeBrief
    beats: list[ScriptBeat]
    report: ValidationReport
    system_prompt: PromptTemplate
    user_prompt: PromptTemplate
    input_tokens: int | None
    output_tokens: int | None
    attempts: int


@dataclass(frozen=True)
class PlanResult:
    """What the ``plan`` stage produced."""

    run: RunContext
    brief: CreativeBrief
    plan: ScriptPlan
    selection: FactSelection
    reused: bool

    @property
    def attempts(self) -> int:
        """How many generation attempts the accepted plan needed."""
        return self.plan.provenance.attempts


def _load_registry(run: RunContext) -> FactRegistry:
    """Load the fact registry of an analysed run.

    Raises:
        StageNotCompletedError: the run has no readable fact registry.
    """
    run.require(run.facts_json, "analyze")
    try:
        return read_model(run.facts_json, FactRegistry)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"facts.json in run {run.run_id} is unreadable ({error}). Re-run 'analyze'."
        ) from error


def _check_analysis_is_current(
    settings: Settings, run: RunContext, registry: FactRegistry, source_path: Path | None
) -> None:
    """Fail when the facts no longer describe the current source document.

    Raises:
        StageNotCompletedError: the analysis is stale or inconsistent.
    """
    manifest = load_manifest(run)
    if manifest is None or not manifest.stage_completed(StageName.ANALYZE):
        raise StageNotCompletedError(
            f"Run {run.run_id} has no recorded analyze stage. Run 'analyze' first."
        )
    if manifest.source_sha256 != registry.source_sha256:
        raise StageNotCompletedError(
            f"Run {run.run_id} is inconsistent: the manifest and facts.json describe "
            "different sources. Re-run 'analyze'."
        )
    path = source_path or settings.source_document
    if path.is_file() and sha256_file(path) != registry.source_sha256:
        raise StageNotCompletedError(
            f"{path.name} changed since the analysis of run {run.run_id}. Re-run 'analyze'."
        )


def _reusable(run: RunContext, source_sha256: str) -> tuple[CreativeBrief, ScriptPlan] | None:
    """Return existing plan artifacts when they belong to this source."""
    if not (run.creative_brief_json.is_file() and run.script_json.is_file()):
        return None
    try:
        brief = read_model(run.creative_brief_json, CreativeBrief)
        plan = read_model(run.script_json, ScriptPlan)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("existing plan is unreadable, regenerating", extra={"error": str(error)})
        return None
    if plan.provenance.source_sha256 != source_sha256:
        return None
    return brief, plan


def _guard_existing_artifacts(run: RunContext, source_sha256: str, force: bool) -> None:
    """Refuse to overwrite a plan that was made from a different source.

    Raises:
        PlanRejectedError: artifacts from another source would be overwritten.
    """
    if force or not run.script_json.is_file():
        return
    try:
        existing = read_model(run.script_json, ScriptPlan)
    except (ValidationError, orjson.JSONDecodeError, OSError):
        return
    if existing.provenance.source_sha256 != source_sha256:
        raise PlanRejectedError(
            f"Run {run.run_id} already holds a plan generated from a different source "
            f"({existing.provenance.source_sha256[:12]}…). Use --force or a new run."
        )


def _render_prompts(
    settings: Settings,
    selection: FactSelection,
    duration_seconds: int,
    language: Language,
    feedback: str,
) -> tuple[PromptTemplate, str, PromptTemplate, str]:
    """Render the system and user prompts for one attempt."""
    system = load_prompt(SYSTEM_PROMPT, settings.prompts_root)
    user = load_prompt(USER_PROMPT, settings.prompts_root)
    policy = _TARGET_POLICY_ALLOWED if selection.allow_targets else _TARGET_POLICY_EXCLUDED
    rendered_user = user.render(
        duration_seconds=duration_seconds,
        language=_LANGUAGE_NAMES[language],
        beat_count=settings.planner_beat_count,
        target_policy=policy,
        facts=selection.render(),
        feedback=f"\nPREVIOUS ATTEMPT REJECTED BY VALIDATION\n{feedback}" if feedback else "",
    )
    return system, system.render(), user, rendered_user


def _default_provider(settings: Settings, registry: FactRegistry, dry_run: bool) -> TextProvider:
    """Return the provider to use when the caller did not supply one."""
    if dry_run:
        return OfflinePlanProvider(registry, beat_count=settings.planner_beat_count)
    from maingott_reel.providers.openai_provider import OpenAITextProvider

    return OpenAITextProvider(settings)


def plan(
    settings: Settings,
    run_id: str | None = None,
    duration: int | None = None,
    language: Language | None = None,
    allow_target_facts: bool | None = None,
    provider: TextProvider | None = None,
    dry_run: bool = False,
    force: bool = False,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> PlanResult:
    """Run the creative planning stage.

    Args:
        settings: effective configuration.
        run_id: run to plan in. Defaults to the most recent run.
        duration: target duration in seconds.
        language: narration language.
        allow_target_facts: offer design-target facts to the planner.
        provider: text provider to use. Defaults to OpenAI, or the offline
            planner when ``dry_run`` is set.
        dry_run: plan without calling a model.
        force: regenerate even if this run already holds a plan.
        source_path: overrides ``settings.source_document`` for staleness checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no analysed run exists.
        StageNotCompletedError: the run has no current Phase 1 analysis.
        PlanRejectedError: no attempt produced a plan that passes validation.
        ProviderError: the text provider failed.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    registry = _load_registry(run)
    _check_analysis_is_current(settings, run, registry, source_path)

    target_duration = settings.resolve_duration(duration)
    reel_language = language or settings.reel_language
    allow_targets = (
        settings.allow_target_facts if allow_target_facts is None else allow_target_facts
    )

    if not force:
        cached = _reusable(run, registry.source_sha256)
        if cached is not None:
            brief, existing_plan = cached
            logger.info(
                "plan reused", extra={"run_id": run.run_id, "beats": len(existing_plan.beats)}
            )
            return PlanResult(
                run=run,
                brief=brief,
                plan=existing_plan,
                selection=select_facts(
                    registry, allow_targets=allow_targets, max_facts=settings.planner_max_facts
                ),
                reused=True,
            )
    _guard_existing_artifacts(run, registry.source_sha256, force)

    selection = select_facts(
        registry, allow_targets=allow_targets, max_facts=settings.planner_max_facts
    )
    if (
        len(selection.facts)
        < ClaimPolicy(target_duration_seconds=target_duration).min_distinct_facts
    ):
        raise StageNotCompletedError(
            f"Run {run.run_id} offers only {len(selection.facts)} usable facts. "
            "Review facts.json before planning."
        )

    policy = ClaimPolicy(
        target_duration_seconds=target_duration,
        min_duration_seconds=settings.min_reel_duration,
        max_duration_seconds=settings.max_reel_duration,
        language=reel_language,
        allow_target_facts=allow_targets,
        min_beats=max(5, settings.planner_beat_count - 3),
        max_beats=min(12, settings.planner_beat_count + 4),
        offered_fact_ids=frozenset(selection.fact_ids),
    )
    text_provider = provider or _default_provider(settings, registry, dry_run)

    generated = _generate(
        settings=settings,
        selection=selection,
        policy=policy,
        registry=registry,
        provider=text_provider,
        duration_seconds=target_duration,
        language=reel_language,
    )

    brief = generated.brief
    provenance = GenerationProvenance(
        generator_version=PLANNER_VERSION,
        prompt_version=f"{generated.system_prompt.version}/{generated.user_prompt.version}",
        system_prompt_sha256=generated.system_prompt.sha256,
        user_prompt_sha256=generated.user_prompt.sha256,
        provider=text_provider.name,
        model=text_provider.model,
        generated_at=datetime.now(tz=UTC),
        source_sha256=registry.source_sha256,
        offered_fact_ids=selection.fact_ids,
        attempts=generated.attempts,
        input_tokens=generated.input_tokens,
        output_tokens=generated.output_tokens,
        target_facts_allowed=allow_targets,
    )
    script_plan = build_plan(
        beats=generated.beats,
        target_duration_seconds=target_duration,
        language=reel_language,
        validation=generated.report,
        provenance=provenance,
    )

    write_model(run.creative_brief_json, brief)
    write_model(run.script_json, script_plan)
    _record_stage(run, script_plan, provenance)

    logger.info(
        "plan complete",
        extra={
            "run_id": run.run_id,
            "beats": len(generated.beats),
            "facts_cited": len(script_plan.source_fact_ids),
            "seconds": script_plan.total_estimated_seconds,
            "attempts": generated.attempts,
            "model": provenance.model,
        },
    )
    return PlanResult(run=run, brief=brief, plan=script_plan, selection=selection, reused=False)


def _generate(
    settings: Settings,
    selection: FactSelection,
    policy: ClaimPolicy,
    registry: FactRegistry,
    provider: TextProvider,
    duration_seconds: int,
    language: Language,
) -> _Generated:
    """Generate until a plan passes validation, or give up.

    Raises:
        PlanRejectedError: every attempt failed validation or conversion.
    """
    feedback = ""
    last_error: str = "no attempt was made"
    for attempt in range(1, settings.planner_max_attempts + 1):
        system, system_text, user, user_text = _render_prompts(
            settings, selection, duration_seconds, language, feedback
        )
        result = provider.generate_structured(
            system_prompt=system_text,
            user_prompt=user_text,
            schema=CreativePlanDraft,
        )
        draft = result.value
        if not isinstance(draft, CreativePlanDraft):
            raise ProviderError(
                f"The provider returned {type(draft).__name__}, expected CreativePlanDraft"
            )

        try:
            brief = build_brief(
                draft,
                target_duration_seconds=duration_seconds,
                language=language,
                aspect_ratio=settings.aspect_ratio,
            )
            beats = build_beats(draft)
        except PlanRejectedError as error:
            last_error = str(error)
            feedback = last_error
            logger.warning("plan draft malformed", extra={"attempt": attempt, "error": last_error})
            continue

        report = validate_plan(beats, brief, registry, policy)
        if report.passed:
            return _Generated(
                brief=brief,
                beats=beats,
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
            "plan rejected by validation",
            extra={
                "attempt": attempt,
                "failed_checks": [check.name for check in report.failures],
            },
        )

    raise PlanRejectedError(
        f"No valid plan after {settings.planner_max_attempts} attempts. Last failures:\n"
        f"{last_error}"
    )


def _record_stage(
    run: RunContext, script_plan: ScriptPlan, provenance: GenerationProvenance
) -> None:
    """Write the plan's provenance into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.models.text = provenance.model
    manifest.prompt_version = provenance.prompt_version
    manifest.files["creative_brief"] = run.creative_brief_json
    manifest.files["script"] = run.script_json
    manifest.record_stage(
        StageName.PLAN,
        completed_at=provenance.generated_at,
        artifact=run.script_json,
        notes=(
            f"{len(script_plan.beats)} beats, {script_plan.total_estimated_seconds}s, "
            f"{len(script_plan.source_fact_ids)} facts cited, validation passed"
        ),
    )
    save_manifest(run, manifest)
