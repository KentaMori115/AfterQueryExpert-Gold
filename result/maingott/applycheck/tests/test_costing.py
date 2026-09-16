"""Cost estimation and the generation budget."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from maingott_reel.config import Settings
from maingott_reel.costing import enforce_budget, load_pricing, plan_generation, write_plan
from maingott_reel.errors import BudgetExceededError
from maingott_reel.models import (
    CostLine,
    CostReport,
    GenerationKind,
    GenerationPlan,
    ModelPrice,
    PricingTable,
)
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext


def _pricing(
    settings: Settings,
    video: float | None = 0.10,
    voice: float | None = 0.015,
) -> Path:
    """Write a pricing table the project would have verified itself."""
    table = PricingTable(
        source="https://example.invalid/pricing checked by the project",
        verified_at=datetime(2026, 8, 20, tzinfo=UTC),
        video={"sora-2": ModelPrice(per_second_usd=video)} if video is not None else {},
        voice={"gpt-4o-mini-tts": ModelPrice(per_1k_characters_usd=voice)}
        if voice is not None
        else {},
    )
    return write_model(settings.pricing_path, table)


# --- pricing ------------------------------------------------------------------


def test_no_pricing_file_means_no_pricing(settings: Settings):
    assert load_pricing(settings) is None


def test_a_pricing_file_is_read(settings: Settings):
    _pricing(settings)
    table = load_pricing(settings)
    assert table is not None
    assert table.price_for(GenerationKind.VIDEO, "sora-2") is not None
    assert table.price_for(GenerationKind.VIDEO, "sora-2-pro") is None


def test_a_malformed_pricing_file_is_reported_not_ignored(settings: Settings):
    """Found in the pilot: a copied template silently read as "no pricing"."""
    from maingott_reel.errors import ConfigurationError

    settings.pricing_path.parent.mkdir(parents=True, exist_ok=True)
    settings.pricing_path.write_text("{not json", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="cannot be read"):
        load_pricing(settings)


def test_the_shipped_pricing_template_loads(settings: Settings):
    example = Path(__file__).resolve().parents[1] / "input/pricing.example.json"
    settings.pricing_path.parent.mkdir(parents=True, exist_ok=True)
    settings.pricing_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")

    table = load_pricing(settings)
    assert table is not None
    assert table.price_for(GenerationKind.VIDEO, "sora-2") is None, "a template prices nothing"


def test_speech_priced_per_token_is_an_upper_bound(
    settings: Settings, storyboarded_run: RunContext
):
    """Speech is billed per token; this project can only bound it."""
    write_model(
        settings.pricing_path,
        PricingTable(voice={"gpt-4o-mini-tts": ModelPrice(per_1m_tokens_usd=0.60)}),
    )

    plan = plan_generation(settings, storyboarded_run, kinds=(GenerationKind.VOICE,))

    line = plan.cost.lines[0]
    assert line.upper_bound
    assert line.price_basis == "per 1M tokens"
    assert line.cost_usd == pytest.approx(line.units / 1_000_000 * 0.60, abs=1e-6)
    assert plan.cost.is_upper_bound
    assert "at most" in plan.cost.summary()
    assert "ceiling" in (line.detail or "")


def test_a_per_second_price_is_exact_not_a_bound(settings: Settings, storyboarded_run: RunContext):
    _pricing(settings)
    plan = plan_generation(settings, storyboarded_run, kinds=(GenerationKind.VIDEO,))

    line = plan.cost.lines[0]
    assert not line.upper_bound
    assert line.price_basis == "per generated second"


def test_a_model_without_a_price_is_not_priced(settings: Settings):
    _pricing(settings, video=None)
    table = load_pricing(settings)
    assert table is not None
    assert table.price_for(GenerationKind.VIDEO, "sora-2") is None


# --- the plan -------------------------------------------------------------------


def test_a_fresh_run_needs_one_call_per_scene_and_one_for_the_voice(
    settings: Settings, storyboarded_run: RunContext
):
    plan = plan_generation(settings, storyboarded_run)

    videos = plan.by_kind(GenerationKind.VIDEO)
    voices = plan.by_kind(GenerationKind.VOICE)
    assert len(videos) == 8
    assert len(voices) == 1
    assert plan.planned_calls == 9
    assert plan.cache_hits == 0
    assert all(item.needs_generation for item in plan.items)
    assert plan.configuration_sha256


def test_cached_work_costs_nothing(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.assets.manager import generate_assets
    from maingott_reel.audio.voice import generate_voice

    generate_assets(settings, run_id=storyboarded_run.run_id, offline=True)
    generate_voice(settings, run_id=storyboarded_run.run_id, offline=True)

    plan = plan_generation(settings, storyboarded_run, offline=True)

    assert plan.planned_calls == 0
    assert plan.cache_hits == 9
    assert plan.cost.calls == 0
    assert plan.cost.total_usd == 0.0
    assert plan.cost.within_budget is None, "no budget is configured, so there is nothing to be in"
    assert "0 paid calls" in plan.cost.summary()


def test_force_prices_the_work_again(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.assets.manager import generate_assets

    generate_assets(settings, run_id=storyboarded_run.run_id, offline=True)

    assert plan_generation(settings, storyboarded_run, offline=True, force=True).planned_calls == 9


def test_without_pricing_the_cost_is_unknown_not_zero(
    settings: Settings, storyboarded_run: RunContext
):
    plan = plan_generation(settings, storyboarded_run)

    assert not plan.cost.known
    assert plan.cost.total_usd is None
    assert "COST UNKNOWN" in plan.cost.summary()


def test_configured_pricing_produces_a_total(settings: Settings, storyboarded_run: RunContext):
    _pricing(settings, video=0.10, voice=0.015)

    plan = plan_generation(settings, storyboarded_run)

    video = next(line for line in plan.cost.lines if line.kind is GenerationKind.VIDEO)
    voice = next(line for line in plan.cost.lines if line.kind is GenerationKind.VOICE)
    assert video.cost_usd == pytest.approx(video.units * 0.10, abs=0.001)
    assert voice.cost_usd == pytest.approx(voice.units / 1000 * 0.015, abs=0.0001)
    assert plan.cost.known
    assert plan.cost.total_usd == pytest.approx(
        (video.cost_usd or 0) + (voice.cost_usd or 0), abs=0.001
    )
    assert plan.cost.pricing_source is not None


def test_partial_pricing_is_still_unknown(settings: Settings, storyboarded_run: RunContext):
    _pricing(settings, video=0.10, voice=None)

    plan = plan_generation(settings, storyboarded_run)

    assert not plan.cost.known
    assert plan.cost.total_usd is None


def test_the_offline_providers_are_free(settings: Settings, storyboarded_run: RunContext):
    plan = plan_generation(settings, storyboarded_run, offline=True)

    assert plan.planned_calls == 9
    assert plan.cost.known
    assert plan.cost.total_usd == 0.0


def test_a_plan_can_be_written_and_read_back(settings: Settings, storyboarded_run: RunContext):
    plan = plan_generation(settings, storyboarded_run)
    path = write_plan(storyboarded_run, plan)

    stored = read_model(path, GenerationPlan)
    assert stored.run_id == storyboarded_run.run_id
    assert stored.planned_calls == plan.planned_calls
    assert stored.dry_run


def test_estimating_costs_nothing_and_needs_no_key(
    settings: Settings, storyboarded_run: RunContext
):
    assert settings.openai_api_key is None
    plan = plan_generation(settings, storyboarded_run)

    assert plan.dry_run
    assert not storyboarded_run.assets_json.exists()
    assert not storyboarded_run.voice_json.exists()


# --- the budget -------------------------------------------------------------------


def _plan(calls: int = 1, cost: float | None = 5.0, budget: float | None = None) -> GenerationPlan:
    from maingott_reel.models import PlannedGeneration

    line = CostLine(
        kind=GenerationKind.VIDEO,
        provider="openai",
        model="sora-2",
        calls=calls,
        units=40,
        unit="generated_seconds",
        cost_usd=cost if calls else 0.0,
    )
    items = [
        PlannedGeneration(
            kind=GenerationKind.VIDEO,
            identity=f"S-{index:02d}-video",
            provider="openai",
            model="sora-2",
            seconds=4.0,
            width=720,
            height=1280,
        )
        for index in range(1, calls + 1)
    ]
    return GenerationPlan(
        run_id="run-1",
        created_at=datetime(2026, 8, 20, tzinfo=UTC),
        configuration_sha256="0" * 64,
        items=items,
        cost=CostReport(lines=[line], budget_usd=budget),
    )


def test_no_budget_configured_lets_generation_proceed(settings: Settings):
    enforce_budget(_plan(calls=1, cost=1000.0), settings)


def test_a_plan_within_budget_proceeds(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 10.0})
    enforce_budget(_plan(calls=1, cost=5.0, budget=10.0), tuned)


def test_a_plan_over_budget_is_refused(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 3.0})
    with pytest.raises(BudgetExceededError, match="over the configured budget"):
        enforce_budget(_plan(calls=1, cost=5.0, budget=3.0), tuned)


def test_an_unknown_cost_is_not_assumed_affordable(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 3.0})
    with pytest.raises(BudgetExceededError, match="unknown"):
        enforce_budget(_plan(calls=1, cost=None, budget=3.0), tuned)


def test_the_override_is_explicit(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 3.0})
    enforce_budget(_plan(calls=1, cost=5.0, budget=3.0), tuned, allow_over_budget=True)
    enforce_budget(_plan(calls=1, cost=None, budget=3.0), tuned, allow_over_budget=True)


def test_a_plan_with_nothing_to_do_is_always_allowed(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 0.0})
    empty = _plan(calls=0, cost=0.0, budget=0.0)
    assert empty.planned_calls == 0
    enforce_budget(empty, tuned)


def test_offline_work_is_never_budgeted(settings: Settings):
    tuned = settings.model_copy(update={"max_generation_cost": 0.0})
    offline = _plan(calls=1, cost=None, budget=0.0).model_copy(update={"offline": True})
    enforce_budget(offline, tuned)


# --- the stages ---------------------------------------------------------------------


def test_offline_generation_is_never_blocked_by_a_budget(
    settings: Settings, storyboarded_run: RunContext
):
    from maingott_reel.assets.manager import generate_assets
    from maingott_reel.audio.voice import generate_voice

    tuned = settings.model_copy(update={"max_generation_cost": 0.0})
    assert generate_assets(tuned, run_id=storyboarded_run.run_id, offline=True).complete
    assert generate_voice(tuned, run_id=storyboarded_run.run_id, offline=True).complete


def test_paid_generation_stops_when_the_cost_is_unknown(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    from maingott_reel.assets import manager
    from maingott_reel.providers.fake import OfflineVideoProvider

    class _PaidLookingProvider(OfflineVideoProvider):
        """An offline provider that reports itself as the real one."""

        @property
        def name(self) -> str:
            return "openai"

        @property
        def model(self) -> str:
            return "sora-2"

    tuned = settings.model_copy(update={"max_generation_cost": 1.0})
    monkeypatch.setattr(
        manager, "build_video_provider", lambda settings, offline: _PaidLookingProvider()
    )

    with pytest.raises(BudgetExceededError, match="unknown"):
        manager.generate_assets(tuned, run_id=storyboarded_run.run_id)

    # Nothing was generated on the way to refusing.
    assert not storyboarded_run.assets_json.exists()


def test_paid_generation_writes_the_plan_it_was_stopped_by(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    from maingott_reel.assets import manager
    from maingott_reel.providers.fake import OfflineVideoProvider

    class _PaidLookingProvider(OfflineVideoProvider):
        @property
        def name(self) -> str:
            return "openai"

        @property
        def model(self) -> str:
            return "sora-2"

    _pricing(settings, video=1.0)
    tuned = settings.model_copy(update={"max_generation_cost": 1.0})
    monkeypatch.setattr(
        manager, "build_video_provider", lambda settings, offline: _PaidLookingProvider()
    )

    with pytest.raises(BudgetExceededError, match="over the configured budget"):
        manager.generate_assets(tuned, run_id=storyboarded_run.run_id)

    stored = read_model(storyboarded_run.generation_plan_json, GenerationPlan)
    assert stored.planned_calls == 8
    assert not stored.dry_run
