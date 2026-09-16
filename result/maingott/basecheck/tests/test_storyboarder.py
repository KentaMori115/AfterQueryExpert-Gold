"""The storyboard stage: preconditions, generation, persistence, idempotency.

All offline: the stage is driven by scripted providers.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import BaseModel

from maingott_reel.config import Settings
from maingott_reel.creative.draft import StoryboardDraft
from maingott_reel.creative.storyboarder import storyboard
from maingott_reel.errors import (
    PlanRejectedError,
    ProviderError,
    RunNotFoundError,
    StageNotCompletedError,
)
from maingott_reel.models import (
    FactRegistry,
    RunManifest,
    ScriptPlan,
    StageName,
    Storyboard,
)
from maingott_reel.providers.fake import ScriptedTextProvider
from maingott_reel.utils.jsonio import read_model, write_json, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, create_run

ShotFactory = Callable[..., StoryboardDraft]


@pytest.fixture
def planned_run(settings: Settings, registry: FactRegistry, script_plan: ScriptPlan) -> RunContext:
    """A run that already holds a validated Phase 2 plan."""
    run = create_run(settings, run_id="run-1")
    write_model(run.facts_json, registry)
    write_model(run.script_json, script_plan)
    manifest = load_or_create_manifest(run)
    manifest.source_sha256 = registry.source_sha256
    manifest.record_stage(StageName.ANALYZE, completed_at=registry.created_at)
    manifest.record_stage(StageName.PLAN, completed_at=script_plan.created_at)
    save_manifest(run, manifest)
    return run


def _provider(*drafts: StoryboardDraft | Exception) -> ScriptedTextProvider:
    return ScriptedTextProvider(list(drafts), model="scripted-visuals")


# --- happy path ----------------------------------------------------------


def test_storyboard_is_written(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))

    assert result.reused is False
    assert result.storyboard.passed
    assert result.run.storyboard_json.is_file()
    assert read_model(result.run.storyboard_json, Storyboard) == result.storyboard
    assert result.storyboard.scene_count == len(result.plan.beats)


def test_the_storyboard_stays_inside_the_plan(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory, script_plan: ScriptPlan
):
    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))

    assert result.storyboard.source_fact_ids == script_plan.source_fact_ids
    assert [scene.voiceover for scene in result.storyboard.scenes] == [
        beat.narration for beat in script_plan.beats
    ]
    assert result.storyboard.total_duration_seconds == 40


def test_provenance_is_recorded(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory, script_plan: ScriptPlan
):
    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    provenance = result.storyboard.provenance

    assert provenance.provider == "fake"
    assert provenance.model == "scripted-visuals"
    assert provenance.prompt_version == "1/3"
    assert provenance.generator_version == "1.0"
    assert provenance.source_sha256 == script_plan.provenance.source_sha256
    assert provenance.attempts == 1


def test_the_manifest_is_updated(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    manifest = read_model(result.run.manifest_json, RunManifest)

    assert manifest.stage_completed(StageName.STORYBOARD)
    assert "storyboard" in manifest.files
    assert manifest.models.text == "scripted-visuals"


def test_the_prompt_carries_the_beats(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory, script_plan: ScriptPlan
):
    provider = _provider(make_shots())
    storyboard(settings, run_id=planned_run.run_id, provider=provider)

    user_prompt = str(provider.calls[0]["user_prompt"])
    for beat in script_plan.beats:
        assert beat.id in user_prompt
        assert beat.narration in user_prompt


def test_a_shorter_reel_rescales_the_timeline(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    result = storyboard(
        settings, run_id=planned_run.run_id, duration=32, provider=_provider(make_shots())
    )
    assert result.storyboard.total_duration_seconds == 32
    assert result.storyboard.target_duration_seconds == 32


def test_dry_run_needs_no_provider(settings: Settings, planned_run: RunContext):
    result = storyboard(settings, run_id=planned_run.run_id, dry_run=True)
    assert result.storyboard.provenance.model == "offline-planner"
    assert result.storyboard.passed


# --- rejection -----------------------------------------------------------


def test_a_shot_that_asks_for_text_is_rejected(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    draft = make_shots(
        {"B-02": {"video_prompt": "The word MAINGOTT appears as bold text over a dark panel."}}
    )
    with pytest.raises(PlanRejectedError, match="no_text_in_footage"):
        storyboard(settings, run_id=planned_run.run_id, provider=_provider(draft, draft, draft))
    assert not planned_run.storyboard_json.exists()


def test_a_missing_shot_is_rejected(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    draft = make_shots()
    draft.shots = draft.shots[:-1]
    with pytest.raises(PlanRejectedError, match="no shot for"):
        storyboard(settings, run_id=planned_run.run_id, provider=_provider(draft, draft, draft))


def test_a_valid_retry_after_a_rejected_attempt_is_accepted(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    bad = make_shots({"B-03": {"video_prompt": "A glowing logo forms in a dark room slowly."}})
    provider = _provider(bad, make_shots())

    result = storyboard(settings, run_id=planned_run.run_id, provider=provider)

    assert result.storyboard.passed
    assert result.attempts == 2
    assert "PREVIOUS ATTEMPT REJECTED" in str(provider.calls[1]["user_prompt"])
    assert "no_text_in_footage" in str(provider.calls[1]["user_prompt"])


def test_a_response_of_the_wrong_type_is_rejected(settings: Settings, planned_run: RunContext):
    class SomethingElse(BaseModel):
        text: str

    with pytest.raises(ProviderError, match="expected StoryboardDraft"):
        storyboard(
            settings,
            run_id=planned_run.run_id,
            provider=ScriptedTextProvider([SomethingElse(text="nope")]),
        )


def test_a_provider_error_is_surfaced(settings: Settings, planned_run: RunContext):
    with pytest.raises(ProviderError, match="ran out"):
        storyboard(settings, run_id=planned_run.run_id, provider=_provider())


# --- preconditions -------------------------------------------------------


def test_without_any_run_it_fails(settings: Settings):
    with pytest.raises(RunNotFoundError):
        storyboard(settings, dry_run=True)


def test_without_a_plan_it_fails(settings: Settings, registry: FactRegistry):
    run = create_run(settings, run_id="unplanned")
    write_model(run.facts_json, registry)
    with pytest.raises(StageNotCompletedError, match="plan"):
        storyboard(settings, run_id=run.run_id, dry_run=True)


def test_an_unreadable_plan_is_reported(settings: Settings, planned_run: RunContext):
    planned_run.script_json.write_text("{ broken", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match="unreadable"):
        storyboard(settings, run_id=planned_run.run_id, dry_run=True)


def test_a_plan_that_failed_validation_is_refused(
    settings: Settings, planned_run: RunContext, script_plan: ScriptPlan
):
    rejected = script_plan.model_dump(mode="json")
    rejected["validation"]["checks"][0]["passed"] = False
    write_json(planned_run.script_json, rejected)
    with pytest.raises(StageNotCompletedError, match="did not pass validation"):
        storyboard(settings, run_id=planned_run.run_id, dry_run=True)


def test_a_plan_made_from_other_facts_is_refused(
    settings: Settings, planned_run: RunContext, registry: FactRegistry
):
    stale = registry.model_copy(update={"source_sha256": "e" * 64})
    write_model(planned_run.facts_json, stale)
    with pytest.raises(StageNotCompletedError, match="different facts"):
        storyboard(settings, run_id=planned_run.run_id, dry_run=True)


def test_a_changed_source_document_is_reported(
    settings: Settings, planned_run: RunContext, tmp_path: Path
):
    source = tmp_path / "spec.docx"
    source.write_bytes(b"changed content")
    with pytest.raises(StageNotCompletedError, match="changed since the analysis"):
        storyboard(settings, run_id=planned_run.run_id, dry_run=True, source_path=source)


def test_unreadable_facts_are_reported(settings: Settings, planned_run: RunContext):
    planned_run.facts_json.write_text("{ broken", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match="unreadable"):
        storyboard(settings, run_id=planned_run.run_id, dry_run=True)


# --- idempotency ---------------------------------------------------------


def test_an_existing_storyboard_is_reused(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    first = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    before = first.run.storyboard_json.read_bytes()

    second = storyboard(settings, run_id=planned_run.run_id, provider=_provider())

    assert second.reused is True
    assert second.run.storyboard_json.read_bytes() == before


def test_a_different_duration_is_rebuilt(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    second = storyboard(
        settings, run_id=planned_run.run_id, duration=35, provider=_provider(make_shots())
    )
    assert second.reused is False
    assert second.storyboard.total_duration_seconds == 35


def test_force_rebuilds(settings: Settings, planned_run: RunContext, make_shots: ShotFactory):
    storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    second = storyboard(
        settings, run_id=planned_run.run_id, force=True, provider=_provider(make_shots())
    )
    assert second.reused is False


def test_a_storyboard_from_another_plan_is_not_overwritten(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))

    stale = result.storyboard.model_dump(mode="json")
    stale["narration_sha256"] = "f" * 64
    write_json(planned_run.storyboard_json, stale)

    with pytest.raises(PlanRejectedError, match="different plan"):
        storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))


def test_an_unreadable_storyboard_is_regenerated(
    settings: Settings, planned_run: RunContext, make_shots: ShotFactory
):
    storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    planned_run.storyboard_json.write_text("{ broken", encoding="utf-8")

    result = storyboard(settings, run_id=planned_run.run_id, provider=_provider(make_shots()))
    assert result.reused is False


def test_the_offline_shot_provider_rejects_an_unexpected_schema(script_plan: ScriptPlan):
    from maingott_reel.providers.fake import OfflineStoryboardProvider

    class Other(BaseModel):
        text: str

    with pytest.raises(ProviderError, match="cannot produce Other"):
        OfflineStoryboardProvider(script_plan).generate_structured(
            system_prompt="s", user_prompt="u", schema=Other
        )


def test_the_default_provider_is_openai_unless_dry_run(settings: Settings, script_plan: ScriptPlan):
    from maingott_reel.creative.storyboarder import _default_provider
    from maingott_reel.errors import ConfigurationError
    from maingott_reel.providers.fake import OfflineStoryboardProvider

    offline = _default_provider(settings, script_plan, dry_run=True)
    assert isinstance(offline, OfflineStoryboardProvider)

    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        _default_provider(settings, script_plan, dry_run=False)

    # With a key present the OpenAI adapter is chosen; it builds no client yet.
    from maingott_reel.providers.openai_provider import OpenAITextProvider

    with_key = Settings(
        output_root=settings.output_root,
        input_root=settings.input_root,
        openai_api_key="sk-test-key",
    )
    assert isinstance(_default_provider(with_key, script_plan, dry_run=False), OpenAITextProvider)
