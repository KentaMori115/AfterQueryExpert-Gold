"""Timing and assembly of the storyboard."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from itertools import pairwise

import pytest

from maingott_reel.creative.draft import DraftShot, StoryboardDraft
from maingott_reel.creative.storyboard_generator import (
    build_scenes,
    build_storyboard,
    distribute_durations,
    render_beats,
)
from maingott_reel.errors import PlanRejectedError
from maingott_reel.models import (
    AssetType,
    GenerationProvenance,
    Language,
    SceneTransition,
    ScriptPlan,
    ValidationCheck,
    ValidationReport,
)
from maingott_reel.utils.hashing import sha256_text

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO_HASH = "0" * 64
ShotFactory = Callable[..., StoryboardDraft]


def _provenance() -> GenerationProvenance:
    return GenerationProvenance(
        generator_version="1.0",
        prompt_version="1/3",
        system_prompt_sha256=ZERO_HASH,
        user_prompt_sha256=ZERO_HASH,
        provider="fake",
        model="offline-planner",
        generated_at=NOW,
        source_sha256=ZERO_HASH,
    )


def _report() -> ValidationReport:
    return ValidationReport(
        created_at=NOW, checks=[ValidationCheck(name="timeline_is_contiguous", passed=True)]
    )


# --- timing --------------------------------------------------------------


def test_durations_land_exactly_on_the_target(script_plan: ScriptPlan):
    durations = distribute_durations(script_plan.beats, 40)
    assert round(sum(durations), 2) == 40.0
    assert len(durations) == len(script_plan.beats)


def test_durations_keep_the_proportions_of_the_plan(script_plan: ScriptPlan):
    durations = distribute_durations(script_plan.beats, 40)
    longest_beat = max(
        range(len(script_plan.beats)), key=lambda i: script_plan.beats[i].estimated_seconds
    )
    assert durations[longest_beat] == max(durations)


def test_durations_rescale_to_a_shorter_reel(script_plan: ScriptPlan):
    assert round(sum(distribute_durations(script_plan.beats, 30)), 2) == 30.0


def test_durations_need_something_to_scale(script_plan: ScriptPlan):
    empty = [
        beat.model_construct(**{**beat.__dict__, "estimated_seconds": 0.0})
        for beat in script_plan.beats
    ]
    with pytest.raises(PlanRejectedError, match="no duration"):
        distribute_durations(empty, 40)


# --- scenes --------------------------------------------------------------


def test_scenes_are_numbered_and_contiguous(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = build_scenes(script_plan, make_shots(), 40)

    assert [scene.id for scene in scenes] == [f"S-{i:02d}" for i in range(1, 9)]
    assert scenes[0].start_seconds == 0
    for previous, following in pairwise(scenes):
        assert following.start_seconds == previous.end_seconds
    assert scenes[-1].end_seconds == 40


def test_scenes_carry_the_plan_verbatim(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = build_scenes(script_plan, make_shots(), 40)
    for scene, beat in zip(scenes, script_plan.beats, strict=True):
        assert scene.beat_id == beat.id
        assert scene.voiceover == beat.narration
        assert scene.overlay_text == beat.on_screen_text
        assert scene.source_fact_ids == beat.source_fact_ids
        assert scene.purpose == beat.purpose


def test_each_scene_declares_its_footage(script_plan: ScriptPlan, make_shots: ShotFactory):
    for scene in build_scenes(script_plan, make_shots(), 40):
        assert len(scene.asset_requirements) == 1
        requirement = scene.asset_requirements[0]
        assert requirement.asset_type is AssetType.VIDEO
        assert requirement.prompt == scene.video_prompt
        assert requirement.duration_seconds == scene.duration_seconds


def test_transitions_come_from_the_model(script_plan: ScriptPlan, make_shots: ShotFactory):
    draft = make_shots({"B-01": {"transition": "fade"}, "B-08": {"transition": "dissolve"}})
    scenes = build_scenes(script_plan, draft, 40)
    assert scenes[0].transition is SceneTransition.FADE
    assert scenes[-1].transition is SceneTransition.DISSOLVE


def test_a_missing_shot_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    draft = make_shots()
    draft.shots = [shot for shot in draft.shots if shot.beat_id != "B-03"]
    with pytest.raises(PlanRejectedError, match="no shot for: B-03"):
        build_scenes(script_plan, draft, 40)


def test_an_invented_beat_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    draft = make_shots()
    draft.shots.append(
        DraftShot(
            beat_id="B-99",
            visual_description="Выдуманная сцена.",
            video_prompt="A dark room with slow moving light and a calm camera push forward.",
            transition="cut",
        )
    )
    with pytest.raises(PlanRejectedError, match="invented beats"):
        build_scenes(script_plan, draft, 40)


def test_two_shots_for_one_beat_are_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    draft = make_shots()
    draft.shots.append(draft.shots[0])
    with pytest.raises(PlanRejectedError, match="more than one shot"):
        build_scenes(script_plan, draft, 40)


def test_a_malformed_shot_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    draft = make_shots({"B-02": {"video_prompt": "x"}})
    with pytest.raises(PlanRejectedError, match="malformed"):
        build_scenes(script_plan, draft, 40)


# --- storyboard ----------------------------------------------------------


def test_storyboard_derives_totals_and_facts(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = build_scenes(script_plan, make_shots(), 40)
    board = build_storyboard(
        scenes=scenes,
        plan=script_plan,
        target_seconds=40,
        language=Language.RU,
        validation=_report(),
        provenance=_provenance(),
        created_at=NOW,
    )
    assert board.total_duration_seconds == 40
    assert board.narration_sha256 == sha256_text(script_plan.narration)
    assert board.source_fact_ids == script_plan.source_fact_ids
    assert board.scene_count == 8
    assert len(board.asset_requirements()) == 8


def test_a_storyboard_that_breaks_the_schema_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = build_scenes(script_plan, make_shots(), 40)
    scenes[0].duration_seconds = 19.0
    with pytest.raises(PlanRejectedError, match="invalid"):
        build_storyboard(
            scenes=scenes,
            plan=script_plan,
            target_seconds=40,
            language=Language.RU,
            validation=_report(),
            provenance=_provenance(),
        )


# --- prompt block --------------------------------------------------------


def test_rendered_beats_carry_everything_the_shot_needs(script_plan: ScriptPlan):
    block = render_beats(script_plan, 40)
    for beat in script_plan.beats:
        assert beat.id in block
        assert beat.narration in block
        assert beat.purpose in block
    assert "caption:" in block


def test_durations_that_cannot_be_scaled_are_rejected(script_plan: ScriptPlan):
    beats = [
        script_plan.beats[0].model_construct(
            **{**script_plan.beats[0].__dict__, "estimated_seconds": 39.999}
        ),
        script_plan.beats[1].model_construct(
            **{**script_plan.beats[1].__dict__, "estimated_seconds": 0.001}
        ),
    ]
    with pytest.raises(PlanRejectedError, match="cannot be scaled"):
        distribute_durations(beats, 40)
