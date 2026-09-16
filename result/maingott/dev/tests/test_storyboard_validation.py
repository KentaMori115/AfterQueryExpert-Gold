"""Deterministic storyboard validation.

The storyboard must carry the approved plan over unchanged and must ask the
video model for footage that post-production can actually use.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from maingott_reel.creative.claims import validate_storyboard
from maingott_reel.creative.draft import StoryboardDraft
from maingott_reel.creative.storyboard_generator import build_scenes
from maingott_reel.models import AssetType, Scene, ScriptPlan

ShotFactory = Callable[..., StoryboardDraft]


def _scenes(
    plan: ScriptPlan, make_shots: ShotFactory, overrides: dict | None = None
) -> list[Scene]:
    return build_scenes(plan, make_shots(overrides or {}), 40)


def _names(report: object) -> set[str]:
    return {check.name for check in report.failures}  # type: ignore[attr-defined]


# --- valid ---------------------------------------------------------------


def test_a_faithful_storyboard_passes(script_plan: ScriptPlan, make_shots: ShotFactory):
    report = validate_storyboard(_scenes(script_plan, make_shots), script_plan, 40)
    assert report.passed, report.failures
    assert len(report.checks) == 9


# --- carrying the plan over ----------------------------------------------


def test_rewritten_voiceover_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[2].voiceover = "MainGott решает все задачи бизнеса."
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "spoken_content_unchanged" in _names(report)


def test_rewritten_overlay_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[1].overlay_text = "Лидер рынка"
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "spoken_content_unchanged" in _names(report)


def test_changed_fact_references_are_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[2].source_fact_ids = ["F-404"]
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "spoken_content_unchanged" in _names(report)


def test_scenes_in_the_wrong_order_are_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    report = validate_storyboard([scenes[1], scenes[0], *scenes[2:]], script_plan, 40)
    assert not report.passed
    assert "scenes_match_beats" in _names(report)


def test_a_dropped_scene_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    report = validate_storyboard(scenes[:-1], script_plan, 40)
    assert not report.passed
    assert "scenes_match_beats" in _names(report)


# --- timing ---------------------------------------------------------------


def test_a_gap_in_the_timeline_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[3].start_seconds = scenes[3].start_seconds + 1.5
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "timeline_is_contiguous" in _names(report)


def test_a_timeline_that_misses_the_target_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    report = validate_storyboard(scenes, script_plan, 35)
    assert not report.passed
    assert "timeline_is_contiguous" in _names(report)


def test_a_scene_that_is_too_short_to_generate_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    scenes[0].duration_seconds = 0.8
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "scene_durations" in _names(report)


def test_a_scene_that_is_too_long_to_generate_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    scenes[0].duration_seconds = 15.0
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "scene_durations" in _names(report)


# --- shot prompts ---------------------------------------------------------


@pytest.mark.parametrize(
    "prompt",
    [
        "A dark room where the word MAINGOTT appears in bold text on a glass panel slowly.",
        "Camera pushes past a screen showing a caption and subtitle over the interface panel.",
        "A logo forms out of light particles in a dark studio while the camera drifts closer.",
        "Dashboard panels with readable labels and numbers glowing in a dark control room.",
        "Elegant typography assembles itself letter by letter across the dark glass surface.",
    ],
)
def test_prompts_that_ask_for_readable_text_are_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory, prompt: str
):
    scenes = _scenes(script_plan, make_shots, {"B-02": {"video_prompt": prompt}})
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "no_text_in_footage" in _names(report)


@pytest.mark.parametrize(
    "prompt",
    [
        "A humanoid robot walks through a dark server hall while the camera tracks alongside.",
        "Green code rain falls across a cyberpunk skyline as the camera tilts slowly upward.",
        "Smiling office workers gather around a laptop in a bright modern open plan office.",
        "A cartoon character waves from a colourful desk while the camera pushes in slowly.",
    ],
)
def test_prompts_with_forbidden_visuals_are_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory, prompt: str
):
    scenes = _scenes(script_plan, make_shots, {"B-02": {"video_prompt": prompt}})
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "visual_style" in _names(report)


def test_a_russian_shot_prompt_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(
        script_plan,
        make_shots,
        {"B-02": {"video_prompt": "Тёмная сцена, камера медленно движется вокруг ядра системы."}},
    )
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "video_prompts_are_usable" in _names(report)


def test_a_too_short_shot_prompt_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots, {"B-02": {"video_prompt": "A dark room."}})
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "video_prompts_are_usable" in _names(report)


def test_a_runaway_shot_prompt_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(
        script_plan, make_shots, {"B-02": {"video_prompt": "A dark premium room. " * 100}}
    )
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "video_prompts_are_usable" in _names(report)


def test_placeholders_in_a_shot_prompt_are_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(
        script_plan,
        make_shots,
        {"B-02": {"video_prompt": "TODO: describe the shot for this beat of the advertisement."}},
    )
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "no_placeholder_text" in _names(report)


# --- assets ---------------------------------------------------------------


def test_a_scene_without_footage_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[0].asset_requirements = []
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "assets_are_declared" in _names(report)


def test_an_asset_that_disagrees_with_its_scene_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    requirement = scenes[0].asset_requirements[0]
    requirement.duration_seconds = 99.0
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "assets_are_declared" in _names(report)


def test_a_second_video_asset_is_rejected(script_plan: ScriptPlan, make_shots: ShotFactory):
    scenes = _scenes(script_plan, make_shots)
    scenes[0].asset_requirements = [
        scenes[0].asset_requirements[0],
        scenes[0].asset_requirements[0].model_copy(),
    ]
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "assets_are_declared" in _names(report)


def test_the_declared_asset_is_video(script_plan: ScriptPlan, make_shots: ShotFactory):
    for scene in _scenes(script_plan, make_shots):
        assert scene.asset_requirements[0].asset_type is AssetType.VIDEO


# --- defence in depth ----------------------------------------------------


def test_a_scene_pointing_at_an_unknown_beat_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    scenes[2] = scenes[2].model_construct(**{**scenes[2].__dict__, "beat_id": "B-99"})
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "spoken_content_unchanged" in _names(report)


def test_an_asset_prompt_that_differs_from_its_scene_is_rejected(
    script_plan: ScriptPlan, make_shots: ShotFactory
):
    scenes = _scenes(script_plan, make_shots)
    scenes[0].asset_requirements[0].prompt = "A completely different shot of a dark room."
    report = validate_storyboard(scenes, script_plan, 40)
    assert not report.passed
    assert "assets_are_declared" in _names(report)
