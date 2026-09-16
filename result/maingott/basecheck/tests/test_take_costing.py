"""What a Reel spoken scene by scene costs, and what it records.

Estimating never generates anything and never needs a key, so everything here
runs against the offline provider or against no provider at all.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from maingott_reel.audio.voice import generate_voice
from maingott_reel.config import Settings
from maingott_reel.creative.claims import validate_storyboard
from maingott_reel.creative.draft import DraftShot, StoryboardDraft
from maingott_reel.creative.storyboard_generator import build_scenes, build_storyboard
from maingott_reel.costing import load_pricing, plan_generation, write_plan
from maingott_reel.models import (
    GenerationKind,
    GenerationPlan,
    ModelPrice,
    PricingTable,
    RequestOutcome,
    ScriptPlan,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.providers.fake import OfflineVoiceProvider
from maingott_reel.release.configuration import snapshot
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.request_log import RequestLog
from maingott_reel.utils.run_context import RunContext

#: Long enough to overrun a five second scene, short enough to fit a wider one.
A_LONG_LINE = "Слово " * 13 + "конец"

def scene_by_scene(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, **overrides: object
) -> Settings:
    """Settings that ask for one take per storyboard scene."""
    monkeypatch.setenv("VOICE_TAKES", "scene")
    return Settings(
        output_root=settings.output_root,
        input_root=settings.input_root,
        **overrides,  # type: ignore[arg-type]
    )


def speak(settings: Settings, run: RunContext, **kwargs: object) -> object:
    """Run the narration stage offline."""
    return generate_voice(settings, run_id=run.run_id, offline=True, **kwargs)  # type: ignore[arg-type]


def stored(run: RunContext) -> VoiceAsset:
    """The narration record the stage wrote."""
    return read_model(run.voice_json, VoiceAsset)


def shots_of(board: Storyboard) -> StoryboardDraft:
    """Rebuild the shot draft a storyboard was made from."""
    return StoryboardDraft(
        shots=[
            DraftShot(
                beat_id=scene.beat_id,
                visual_description=scene.visual_description,
                video_prompt=scene.video_prompt,
                transition=scene.transition.value,
            )
            for scene in board.scenes
        ]
    )


def rescale(run: RunContext, seconds: int) -> Storyboard:
    """Lay the same plan out over a Reel of a different length."""
    plan = read_model(run.script_json, ScriptPlan)
    board = read_model(run.storyboard_json, Storyboard)
    scenes = build_scenes(plan, shots_of(board), seconds)
    rebuilt = build_storyboard(
        scenes=scenes,
        plan=plan,
        target_seconds=seconds,
        language=board.language,
        validation=validate_storyboard(scenes, plan, seconds, created_at=board.created_at),
        provenance=board.provenance,
        created_at=board.created_at,
    )
    write_model(run.storyboard_json, rebuilt)
    return rebuilt


def say(run: RunContext, position: int, words: str, seconds: int = 40) -> Storyboard:
    """Give one beat different words, everywhere the pipeline keeps them."""
    plan = read_model(run.script_json, ScriptPlan)
    beats = list(plan.beats)
    beats[position] = beats[position].model_copy(update={"narration": words.strip()})
    write_model(
        run.script_json,
        plan.model_copy(
            update={"beats": beats, "narration": "\n".join(beat.narration for beat in beats)}
        ),
    )
    return rescale(run, seconds)


def priced(settings: Settings, per_1k: float = 0.015) -> Path:
    """A pricing table the project would have checked itself."""
    return write_model(
        settings.pricing_path,
        PricingTable(
            source="https://example.invalid/pricing checked by the project",
            verified_at=datetime(2026, 8, 20, tzinfo=UTC),
            video={"sora-2": ModelPrice(per_second_usd=0.10)},
            voice={"gpt-4o-mini-tts": ModelPrice(per_1k_characters_usd=per_1k)},
        ),
    )


def voice_items(plan: GenerationPlan) -> list:
    """Everything the plan would ask a speech model for."""
    return plan.by_kind(GenerationKind.VOICE)


def voice_line(plan: GenerationPlan):
    """The cost line for narration."""
    return next(line for line in plan.cost.lines if line.kind is GenerationKind.VOICE)


def outcomes(run: RunContext) -> list[RequestOutcome]:
    """Every speech request this run made, in order."""
    return [
        record.outcome
        for record in RequestLog(run.provider_log, run.run_id).read()
        if record.operation == "audio.speech"
    ]


# --- what the estimate says ---------------------------------------------------


def test_the_estimate_lists_one_item_per_take(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    plan = plan_generation(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert [item.scene_id for item in voice_items(plan)] == [
        scene.id for scene in board.scenes
    ]


def test_a_whole_reel_estimate_is_one_item(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    whole = plan_generation(settings, storyboarded_run)
    cut = plan_generation(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert len(voice_items(whole)) == 1
    assert voice_items(whole)[0].scene_id is None
    assert len(voice_items(cut)) == 8


def test_each_planned_take_carries_the_words_it_would_speak(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    plan = plan_generation(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert [item.characters for item in voice_items(plan)] == [
        len(scene.voiceover) for scene in board.scenes
    ]


def test_repeated_words_are_one_call_in_the_estimate(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)

    estimate = plan_generation(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert len(voice_items(estimate)) == 8
    assert voice_line(estimate).calls == 7


def test_distinct_words_are_a_call_each(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    estimate = plan_generation(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert voice_line(estimate).calls == 8


def test_a_reel_already_spoken_costs_nothing_to_speak_again(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    tuned = scene_by_scene(settings, monkeypatch)
    speak(tuned, storyboarded_run)

    estimate = plan_generation(tuned, storyboarded_run, offline=True)

    assert len(voice_items(estimate)) == 8
    assert voice_line(estimate).calls == 0
    assert voice_line(estimate).cost_usd == 0.0


def test_the_estimate_is_priced_per_take(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    tuned = scene_by_scene(settings, monkeypatch)
    priced(tuned)

    estimate = plan_generation(tuned, storyboarded_run)

    line = voice_line(estimate)
    assert line.calls == 8
    assert line.cost_usd is not None and line.cost_usd > 0
    assert load_pricing(tuned) is not None


def test_the_estimate_generates_nothing(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    tuned = scene_by_scene(settings, monkeypatch)

    estimate = plan_generation(tuned, storyboarded_run)

    assert len(voice_items(estimate)) == 8
    assert not storyboarded_run.voice_json.exists()
    assert not storyboarded_run.voice_audio(".wav").exists()


def test_the_estimate_can_be_written_and_read_back(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    tuned = scene_by_scene(settings, monkeypatch)
    estimate = plan_generation(tuned, storyboarded_run)

    write_plan(storyboarded_run, estimate)
    reloaded = read_model(storyboarded_run.generation_plan_json, GenerationPlan)

    scenes = [item.scene_id for item in voice_items(reloaded)]
    assert scenes == [item.scene_id for item in voice_items(estimate)]
    assert len(scenes) == 8
    assert None not in scenes


# --- what the run actually asks for -------------------------------------------


def test_one_request_is_recorded_for_every_scene(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert len(outcomes(storyboarded_run)) == 8
    assert set(outcomes(storyboarded_run)) == {RequestOutcome.SUCCESS}


def test_a_repeated_line_is_served_rather_than_spoken_again(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)

    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    recorded = outcomes(storyboarded_run)
    assert len(recorded) == 8
    assert recorded.count(RequestOutcome.CACHE_HIT) == 1
    assert recorded.count(RequestOutcome.SUCCESS) == 7


def test_the_second_scene_that_repeats_a_line_is_the_one_served(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None
    assert outcomes(storyboarded_run)[3] is RequestOutcome.CACHE_HIT


def test_re_speaking_the_reel_records_every_take_again(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    from maingott_reel.models import VoiceFitStrategy

    say(storyboarded_run, 4, A_LONG_LINE)

    generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    )

    assert len(outcomes(storyboarded_run)) == 16


def test_a_rescaled_reel_speaks_nothing_new(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    tuned = scene_by_scene(settings, monkeypatch)
    speak(tuned, storyboarded_run)
    rescale(storyboarded_run, 35)

    speak(tuned, storyboarded_run)

    assert outcomes(storyboarded_run)[8:] == [RequestOutcome.CACHE_HIT] * 8


# --- what the run records about itself ----------------------------------------


def test_how_the_reel_was_cut_is_part_of_its_configuration(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    whole = snapshot(settings)
    cut = snapshot(scene_by_scene(settings, monkeypatch))

    assert whole.sha256 != cut.sha256


def test_the_stored_track_names_every_take(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    stored = read_model(storyboarded_run.voice_json, VoiceAsset)
    assert [take.scene_id for take in stored.takes] == [scene.id for scene in board.scenes]
    assert [take.start_seconds for take in stored.takes] == [
        scene.start_seconds for scene in board.scenes
    ]


def test_the_stored_track_measures_each_take(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    stored = read_model(storyboarded_run.voice_json, VoiceAsset)
    for take, scene in zip(stored.takes, board.scenes, strict=True):
        assert 0 < take.duration_seconds <= scene.duration_seconds + 0.25
        assert take.speed is None


def test_the_manifest_still_records_one_narration_stage(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    from maingott_reel.models import RunManifest, StageName

    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    manifest = read_model(storyboarded_run.manifest_json, RunManifest)
    assert manifest.stage_completed(StageName.GENERATE_VOICE)
    assert manifest.files["voice"] == storyboarded_run.voice_json
    assert len(read_model(storyboarded_run.voice_json, VoiceAsset).takes) == 8
