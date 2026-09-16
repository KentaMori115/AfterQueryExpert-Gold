"""Building the composition timeline."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.errors import CompositionError
from maingott_reel.models import (
    AssetCollection,
    AudioPlan,
    CompositionSettings,
    CropPolicy,
    Scene,
    SceneTransition,
    Storyboard,
    TextRole,
)
from maingott_reel.video.timeline import (
    assets_identity,
    build_audio_plan,
    build_captions,
    build_timeline,
    composition_identity,
    resolve_transition,
    scale_and_crop,
)

SETTINGS = CompositionSettings()


# --- geometry --------------------------------------------------------------


def test_portrait_footage_is_upscaled_without_cropping():
    geometry = scale_and_crop(720, 1280, SETTINGS)
    assert (geometry.scaled_width, geometry.scaled_height) == (1080, 1920)
    assert (geometry.crop_x, geometry.crop_y) == (0, 0)
    assert geometry.is_upscale
    assert geometry.policy is CropPolicy.CENTER


def test_landscape_footage_is_scaled_to_cover_and_centre_cropped():
    geometry = scale_and_crop(1280, 720, SETTINGS)
    assert geometry.scaled_height == 1920
    assert geometry.scaled_width >= 1080
    assert geometry.crop_x == (geometry.scaled_width - 1080) // 2
    assert geometry.crop_y == 0


def test_taller_than_target_footage_is_cropped_vertically():
    geometry = scale_and_crop(1024, 1792, SETTINGS)
    assert geometry.scaled_width >= 1080
    assert geometry.crop_x >= 0
    assert geometry.output_width == 1080


def test_scaled_dimensions_are_even():
    for width, height in [(719, 1279), (1281, 721), (1023, 1791)]:
        geometry = scale_and_crop(width, height, SETTINGS)
        assert geometry.scaled_width % 2 == 0
        assert geometry.scaled_height % 2 == 0


def test_geometry_is_deterministic():
    assert scale_and_crop(1280, 720, SETTINGS) == scale_and_crop(1280, 720, SETTINGS)


def test_footage_without_dimensions_is_refused():
    with pytest.raises(CompositionError, match="no usable size"):
        scale_and_crop(0, 0, SETTINGS)


# --- transitions ------------------------------------------------------------


def _scene(storyboard: Storyboard, index: int = 0) -> Scene:
    return storyboard.scenes[index]


def test_a_cut_needs_no_overlap(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.CUT})
    assert resolve_transition(scene, surplus_seconds=3.0, is_last=False, settings=SETTINGS) == 0.0


def test_a_fade_needs_no_overlap(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.FADE})
    assert resolve_transition(scene, surplus_seconds=0.0, is_last=True, settings=SETTINGS) == 0.0


def test_a_dissolve_uses_the_configured_overlap(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.DISSOLVE})
    assert resolve_transition(scene, surplus_seconds=3.0, is_last=False, settings=SETTINGS) == (
        SETTINGS.transition_seconds
    )


def test_a_dissolve_is_capped_by_the_surplus_footage(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.DISSOLVE})
    assert resolve_transition(scene, surplus_seconds=0.25, is_last=False, settings=SETTINGS) == 0.25


def test_a_dissolve_without_surplus_footage_is_refused(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.DISSOLVE})
    with pytest.raises(CompositionError, match="surplus footage"):
        resolve_transition(scene, surplus_seconds=0.01, is_last=False, settings=SETTINGS)


def test_the_last_scene_cannot_dissolve(storyboard_fixture: Storyboard):
    scene = _scene(storyboard_fixture).model_copy(update={"transition": SceneTransition.DISSOLVE})
    with pytest.raises(CompositionError, match="cannot dissolve"):
        resolve_transition(scene, surplus_seconds=3.0, is_last=True, settings=SETTINGS)


# --- the timeline -----------------------------------------------------------


def _assets(composed_run) -> AssetCollection:
    from maingott_reel.models import AssetCollection as Collection
    from maingott_reel.utils.jsonio import read_model

    return read_model(composed_run.assets_json, Collection)


def test_the_timeline_matches_the_storyboard(composed_run, storyboard_fixture: Storyboard):
    scenes = build_timeline(storyboard_fixture, _assets(composed_run), SETTINGS)

    assert [scene.scene_id for scene in scenes] == [s.id for s in storyboard_fixture.scenes]
    assert [scene.beat_id for scene in scenes] == [s.beat_id for s in storyboard_fixture.scenes]
    assert scenes[0].start_seconds == 0
    assert round(scenes[-1].end_seconds, 2) == storyboard_fixture.total_duration_seconds


def test_scene_durations_are_taken_from_the_storyboard(
    composed_run, storyboard_fixture: Storyboard
):
    for scene, approved in zip(
        build_timeline(storyboard_fixture, _assets(composed_run), SETTINGS),
        storyboard_fixture.scenes,
        strict=True,
    ):
        assert scene.duration_seconds == approved.duration_seconds
        assert scene.start_seconds == approved.start_seconds


def test_longer_clips_are_trimmed_to_their_scene(composed_run, storyboard_fixture: Storyboard):
    for scene in build_timeline(storyboard_fixture, _assets(composed_run), SETTINGS):
        assert scene.trim_duration_seconds <= scene.source_duration_seconds + 0.01
        assert scene.trim_duration_seconds >= scene.duration_seconds


def test_a_missing_asset_is_refused(composed_run, storyboard_fixture: Storyboard):
    assets = _assets(composed_run)
    thinned = assets.model_copy(update={"assets": assets.assets[1:]})
    with pytest.raises(CompositionError, match="no generated asset"):
        build_timeline(storyboard_fixture, thinned, SETTINGS)


def test_an_unusable_asset_is_refused(composed_run, storyboard_fixture: Storyboard):
    from maingott_reel.models import AssetStatus

    assets = _assets(composed_run)
    broken = assets.assets[0].model_construct(
        **{
            **assets.assets[0].__dict__,
            "status": AssetStatus.FAILED,
            "error": "the model refused",
        }
    )
    with pytest.raises(CompositionError, match=r"not usable|failed"):
        build_timeline(
            storyboard_fixture,
            assets.model_copy(update={"assets": [broken, *assets.assets[1:]]}),
            SETTINGS,
        )


def test_a_missing_file_is_refused(composed_run, storyboard_fixture: Storyboard):
    assets = _assets(composed_run)
    path = assets.assets[0].path
    assert path is not None
    path.unlink()
    with pytest.raises(CompositionError, match="missing"):
        build_timeline(storyboard_fixture, assets, SETTINGS)


def test_a_clip_shorter_than_its_scene_is_refused(composed_run, storyboard_fixture: Storyboard):
    assets = _assets(composed_run)
    short = assets.assets[0].model_copy(update={"actual_duration_seconds": 0.5})
    with pytest.raises(CompositionError, match="Regenerate"):
        build_timeline(
            storyboard_fixture,
            assets.model_copy(update={"assets": [short, *assets.assets[1:]]}),
            SETTINGS,
        )


# --- captions ----------------------------------------------------------------


def test_captions_copy_the_approved_overlay_text(storyboard_fixture: Storyboard):
    cues = build_captions(storyboard_fixture, SETTINGS)
    approved = [scene.overlay_text for scene in storyboard_fixture.scenes if scene.overlay_text]
    assert [cue.text for cue in cues] == approved


def test_the_closing_caption_gets_the_brand_treatment(storyboard_fixture: Storyboard):
    cues = build_captions(storyboard_fixture, SETTINGS)
    assert cues[-1].role is TextRole.BRAND
    assert all(cue.role is TextRole.CAPTION for cue in cues[:-1])


def test_captions_sit_inside_their_scene(storyboard_fixture: Storyboard):
    for cue in build_captions(storyboard_fixture, SETTINGS):
        scene = next(s for s in storyboard_fixture.scenes if s.id == cue.scene_id)
        assert cue.start_seconds >= scene.start_seconds - 0.001
        assert cue.end_seconds <= scene.end_seconds + 0.001


def test_scenes_without_overlay_text_get_no_caption(storyboard_fixture: Storyboard):
    payload = storyboard_fixture.model_dump()
    payload["scenes"][0]["overlay_text"] = ""
    stripped = Storyboard.model_validate(payload)
    cues = build_captions(stripped, SETTINGS)
    assert all(cue.scene_id != "S-01" for cue in cues)


# --- audio and identity -------------------------------------------------------


def test_a_missing_audio_file_is_refused(tmp_path: Path):
    with pytest.raises(CompositionError, match="voice track does not exist"):
        build_audio_plan(tmp_path / "absent.wav", None, SETTINGS)


def test_a_silent_plan_is_marked_silent():
    plan = build_audio_plan(None, None, SETTINGS, silent=True)
    assert plan.silent
    assert not plan.has_music


def test_composition_identity_is_stable():
    audio = AudioPlan()
    first = composition_identity("a" * 64, "b" * 64, audio, None, "font", SETTINGS, "1.0")
    second = composition_identity("a" * 64, "b" * 64, audio, None, "font", SETTINGS, "1.0")
    assert first == second


@pytest.mark.parametrize(
    "change",
    ["storyboard", "assets", "voice", "music", "logo", "font", "settings", "version"],
)
def test_changing_any_input_changes_the_composition_identity(change: str):
    audio = AudioPlan()
    base = composition_identity("a" * 64, "b" * 64, audio, None, "font", SETTINGS, "1.0")

    arguments = {
        "storyboard_sha256": "a" * 64,
        "assets_sha256": "b" * 64,
        "audio": audio,
        "logo_sha256": None,
        "font_identity": "font",
        "settings": SETTINGS,
        "version": "1.0",
    }
    if change == "storyboard":
        arguments["storyboard_sha256"] = "c" * 64
    elif change == "assets":
        arguments["assets_sha256"] = "c" * 64
    elif change == "voice":
        arguments["audio"] = audio.model_copy(update={"voice_sha256": "d" * 64})
    elif change == "music":
        arguments["audio"] = audio.model_copy(update={"music_sha256": "e" * 64})
    elif change == "logo":
        arguments["logo_sha256"] = "f" * 64
    elif change == "font":
        arguments["font_identity"] = "another-font"
    elif change == "settings":
        arguments["settings"] = SETTINGS.model_copy(update={"video_crf": 30})
    else:
        arguments["version"] = "2.0"

    assert composition_identity(**arguments) != base  # type: ignore[arg-type]


def test_assets_identity_follows_the_files(composed_run):
    assets = _assets(composed_run)
    changed = assets.model_copy(
        update={
            "assets": [assets.assets[0].model_copy(update={"sha256": "9" * 64}), *assets.assets[1:]]
        }
    )
    assert assets_identity(assets) != assets_identity(changed)
