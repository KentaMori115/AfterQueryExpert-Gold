"""The plan stage: generation, validation, persistence and idempotency.

Every test here runs offline: the planner is driven by scripted providers, so
no OpenAI key or network access is needed.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import BaseModel

from maingott_reel.config import Settings
from maingott_reel.creative.draft import CreativePlanDraft
from maingott_reel.creative.planner import plan
from maingott_reel.errors import (
    PlanRejectedError,
    ProviderError,
    RunNotFoundError,
    StageNotCompletedError,
)
from maingott_reel.models import (
    ClaimStatus,
    CreativeBrief,
    FactRegistry,
    RunManifest,
    ScriptPlan,
    StageName,
)
from maingott_reel.providers.fake import ScriptedTextProvider
from maingott_reel.utils.jsonio import read_model, write_json, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, create_run

DraftFactory = Callable[..., CreativePlanDraft]


@pytest.fixture
def analysed_run(settings: Settings, registry: FactRegistry) -> RunContext:
    """A run that already holds a Phase 1 analysis."""
    run = create_run(settings, run_id="run-1")
    write_model(run.facts_json, registry)
    manifest = load_or_create_manifest(run)
    manifest.source_sha256 = registry.source_sha256
    manifest.record_stage(StageName.ANALYZE, completed_at=registry.created_at)
    save_manifest(run, manifest)
    return run


def _provider(*drafts: CreativePlanDraft | Exception) -> ScriptedTextProvider:
    return ScriptedTextProvider(list(drafts), model="scripted-planner")


# --- happy path ----------------------------------------------------------


def test_plan_writes_brief_and_script(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    result = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))

    assert result.reused is False
    assert result.plan.passed
    assert result.run.creative_brief_json.is_file()
    assert result.run.script_json.is_file()
    assert read_model(result.run.script_json, ScriptPlan) == result.plan
    assert read_model(result.run.creative_brief_json, CreativeBrief) == result.brief


def test_plan_is_traceable_to_facts(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    result = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))

    assert result.plan.source_fact_ids
    for claim in result.plan.claims:
        assert claim.source_fact_ids
        for fact_id in claim.source_fact_ids:
            assert result.plan.provenance.offered_fact_ids.count(fact_id) == 1


def test_plan_records_provenance(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, registry: FactRegistry
):
    result = plan(
        settings, run_id=analysed_run.run_id, duration=35, provider=_provider(make_draft())
    )
    provenance = result.plan.provenance

    assert provenance.provider == "fake"
    assert provenance.model == "scripted-planner"
    assert provenance.prompt_version == "1/1"
    assert provenance.source_sha256 == registry.source_sha256
    assert provenance.attempts == 1
    assert provenance.target_facts_allowed is False
    assert result.plan.target_duration_seconds == 35


def test_plan_updates_the_manifest(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    result = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))
    manifest = read_model(result.run.manifest_json, RunManifest)

    assert manifest.stage_completed(StageName.PLAN)
    assert manifest.models.text == "scripted-planner"
    assert manifest.prompt_version == "1/1"
    assert set(manifest.files) >= {"creative_brief", "script"}


def test_the_prompt_carries_facts_but_not_the_document(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    provider = _provider(make_draft())
    plan(settings, run_id=analysed_run.run_id, provider=provider)

    user_prompt = str(provider.calls[0]["user_prompt"])
    assert "F-001" in user_prompt
    assert "Единая омниканальная платформа MainGott" in user_prompt
    assert "F-901" not in user_prompt, "unsupported facts must never be offered"
    assert "F-900" not in user_prompt, "target facts are excluded by default"
    assert "ТЕХНИЧЕСКОЕ ЗАДАНИЕ" not in user_prompt


def test_target_facts_are_offered_only_on_request(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    provider = _provider(make_draft())
    plan(settings, run_id=analysed_run.run_id, allow_target_facts=True, provider=provider)

    user_prompt = str(provider.calls[0]["user_prompt"])
    assert "F-900" in user_prompt
    assert "[TARGET" in user_prompt


def test_dry_run_needs_no_provider(settings: Settings, analysed_run: RunContext):
    result = plan(settings, run_id=analysed_run.run_id, dry_run=True)
    assert result.plan.provenance.model == "offline-planner"
    assert result.plan.passed


# --- rejection -----------------------------------------------------------


def test_fabricated_fact_ids_are_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["claims"] = [
        {
            "claim": "MainGott работает с несуществующим фактом.",
            "kind": "factual",
            "source_fact_ids": ["F-404"],
        }
    ]
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError, match="facts_exist"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider(draft, draft, draft))
    assert not analysed_run.script_json.exists()


def test_unsupported_facts_are_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["claims"] = [
        {"claim": "Тысячи компаний уже с нами.", "kind": "factual", "source_fact_ids": ["F-901"]}
    ]
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError) as error:
        plan(settings, run_id=analysed_run.run_id, provider=_provider(draft, draft, draft))
    assert "no_unsupported_facts" in str(error.value) or "facts_were_offered" in str(error.value)


def test_target_fact_presented_as_achieved_is_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["claims"] = [
        {
            "claim": "MainGott отвечает за 60 секунд.",
            "kind": "factual",
            "source_fact_ids": ["F-900"],
        }
    ]
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError, match="target_facts_not_presented_as_achieved"):
        plan(
            settings,
            run_id=analysed_run.run_id,
            allow_target_facts=True,
            provider=_provider(draft, draft, draft),
        )


def test_a_claim_without_fact_ids_is_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["claims"] = [
        {"claim": "MainGott объединяет каналы.", "kind": "factual", "source_fact_ids": []}
    ]
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError, match="malformed"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider(draft, draft, draft))


def test_a_factual_beat_without_claims_is_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["claims"] = []
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError, match="malformed"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider(draft, draft, draft))


def test_superlatives_are_rejected(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    draft_beats[2]["narration"] = "MainGott — лучшая платформа на рынке."
    draft = make_draft(draft_beats)
    with pytest.raises(PlanRejectedError, match="no_unsupported_superlatives"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider(draft, draft, draft))


def test_a_valid_retry_after_a_rejected_attempt_is_accepted(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, draft_beats: list
):
    bad_beats = [dict(beat) for beat in draft_beats]
    bad_beats[2]["claims"] = [
        {"claim": "Выдумка.", "kind": "factual", "source_fact_ids": ["F-404"]}
    ]
    provider = _provider(make_draft(bad_beats), make_draft())

    result = plan(settings, run_id=analysed_run.run_id, provider=provider)

    assert result.plan.passed
    assert result.attempts == 2
    assert "PREVIOUS ATTEMPT REJECTED" in str(provider.calls[1]["user_prompt"])
    assert "F-404" in str(provider.calls[1]["user_prompt"])


def test_a_provider_error_is_surfaced(settings: Settings, analysed_run: RunContext):
    provider = ScriptedTextProvider([ProviderError("model returned nothing usable")])
    with pytest.raises(ProviderError, match="nothing usable"):
        plan(settings, run_id=analysed_run.run_id, provider=provider)


def test_a_response_of_the_wrong_type_is_rejected(settings: Settings, analysed_run: RunContext):
    class SomethingElse(BaseModel):
        text: str

    provider = ScriptedTextProvider([SomethingElse(text="not a plan")])
    with pytest.raises(ProviderError, match="expected CreativePlanDraft"):
        plan(settings, run_id=analysed_run.run_id, provider=provider)


def test_the_provider_running_out_of_results_is_reported(
    settings: Settings, analysed_run: RunContext
):
    with pytest.raises(ProviderError, match="ran out"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider())


# --- preconditions -------------------------------------------------------


def test_planning_without_any_run_fails(settings: Settings):
    with pytest.raises(RunNotFoundError):
        plan(settings, dry_run=True)


def test_planning_without_an_analysis_fails(settings: Settings):
    create_run(settings, run_id="empty")
    with pytest.raises(StageNotCompletedError, match="analyze"):
        plan(settings, run_id="empty", dry_run=True)


def test_unreadable_facts_are_reported(settings: Settings, analysed_run: RunContext):
    analysed_run.facts_json.write_text("{ broken", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match="unreadable"):
        plan(settings, run_id=analysed_run.run_id, dry_run=True)


def test_a_manifest_that_disagrees_with_the_facts_is_reported(
    settings: Settings, analysed_run: RunContext
):
    manifest = load_or_create_manifest(analysed_run)
    manifest.source_sha256 = "c" * 64
    save_manifest(analysed_run, manifest)
    with pytest.raises(StageNotCompletedError, match="different sources"):
        plan(settings, run_id=analysed_run.run_id, dry_run=True)


def test_a_changed_source_document_is_reported(
    settings: Settings, analysed_run: RunContext, tmp_path: Path
):
    source = tmp_path / "spec.docx"
    source.write_bytes(b"changed content")
    with pytest.raises(StageNotCompletedError, match="changed since the analysis"):
        plan(settings, run_id=analysed_run.run_id, dry_run=True, source_path=source)


def test_too_few_usable_facts_is_reported(settings: Settings, registry: FactRegistry):
    run = create_run(settings, run_id="thin")
    thin = registry.model_copy(update={"facts": registry.facts[:1]})
    write_model(run.facts_json, thin)
    manifest = load_or_create_manifest(run)
    manifest.source_sha256 = thin.source_sha256
    manifest.record_stage(StageName.ANALYZE, completed_at=thin.created_at)
    save_manifest(run, manifest)

    with pytest.raises(StageNotCompletedError, match="usable facts"):
        plan(settings, run_id=run.run_id, dry_run=True)


# --- idempotency ---------------------------------------------------------


def test_an_existing_plan_is_reused(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    first = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))
    before = first.run.script_json.read_bytes()

    second = plan(settings, run_id=analysed_run.run_id, provider=_provider())

    assert second.reused is True
    assert second.run.script_json.read_bytes() == before


def test_force_replans(settings: Settings, analysed_run: RunContext, make_draft: DraftFactory):
    plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))
    second = plan(
        settings, run_id=analysed_run.run_id, force=True, provider=_provider(make_draft())
    )
    assert second.reused is False
    assert second.plan.passed


def test_a_plan_from_another_source_is_not_overwritten(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory, registry: FactRegistry
):
    result = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))

    stale = result.plan.model_dump(mode="json")
    stale["provenance"]["source_sha256"] = "d" * 64
    write_json(analysed_run.script_json, stale)

    with pytest.raises(PlanRejectedError, match="different source"):
        plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))


def test_an_unreadable_plan_is_regenerated(
    settings: Settings, analysed_run: RunContext, make_draft: DraftFactory
):
    plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))
    analysed_run.script_json.write_text("{ broken", encoding="utf-8")

    result = plan(settings, run_id=analysed_run.run_id, provider=_provider(make_draft()))
    assert result.reused is False


def test_registry_targets_are_still_marked(registry: FactRegistry):
    assert registry.by_status(ClaimStatus.TARGET)
    assert registry.by_status(ClaimStatus.UNSUPPORTED)


def test_a_run_without_a_manifest_is_reported(settings: Settings, registry: FactRegistry):
    run = create_run(settings, run_id="no-manifest")
    write_model(run.facts_json, registry)
    with pytest.raises(StageNotCompletedError, match="no recorded analyze stage"):
        plan(settings, run_id=run.run_id, dry_run=True)


def test_the_offline_planner_rejects_an_unexpected_schema(registry: FactRegistry):
    from maingott_reel.providers.fake import OfflinePlanProvider

    class Other(BaseModel):
        text: str

    with pytest.raises(ProviderError, match="cannot produce Other"):
        OfflinePlanProvider(registry).generate_structured(
            system_prompt="s", user_prompt="u", schema=Other
        )


def test_the_offline_planner_needs_enough_facts(registry: FactRegistry):
    from maingott_reel.providers.fake import OfflinePlanProvider

    thin = registry.model_copy(update={"facts": registry.facts[:2]})
    with pytest.raises(ProviderError, match="too few usable facts"):
        OfflinePlanProvider(thin).generate_structured(
            system_prompt="s", user_prompt="u", schema=CreativePlanDraft
        )
