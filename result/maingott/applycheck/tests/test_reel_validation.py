"""Validating the finished Reel."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from maingott_reel.assets.probe import MediaInfo, ProbeError
from maingott_reel.models import (
    AudioPlan,
    CaptionCue,
    Composition,
    CompositionSettings,
    FontInfo,
    ScaleCrop,
    SceneTransition,
    ScriptPlan,
    Storyboard,
    TextRole,
    TimelineScene,
)
from maingott_reel.video.validation import production_readiness, validate_reel

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO = "0" * 64


class _StubProbe:
    def __init__(self, info: MediaInfo | Exception) -> None:
        self._info = info

    @property
    def name(self) -> str:
        return "stub"

    def inspect(self, path: Path) -> MediaInfo:
        if isinstance(self._info, Exception):
            raise self._info
        return self._info


def _info(**overrides: object) -> MediaInfo:
    fields: dict[str, object] = {
        "duration_seconds": 40.0,
        "width": 1080,
        "height": 1920,
        "codec": "h264",
        "frame_rate": 30.0,
        "has_video_stream": True,
        "has_audio_stream": True,
        "tool": "stub",
    }
    fields.update(overrides)
    return MediaInfo(**fields)  # type: ignore[arg-type]


@pytest.fixture
def reel(tmp_path: Path) -> Path:
    path = tmp_path / "maingott_reel.mp4"
    path.write_bytes(b"x" * 5000)
    return path


@pytest.fixture
def composition(
    tmp_path: Path, storyboard_fixture: Storyboard, script_plan: ScriptPlan, reel: Path
) -> Composition:
    settings = CompositionSettings()
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip")
    scenes = []
    start = 0.0
    for position, scene in enumerate(storyboard_fixture.scenes, start=1):
        scenes.append(
            TimelineScene(
                scene_id=scene.id,
                beat_id=scene.beat_id,
                order=position,
                asset_id=f"{scene.id}-video-abc",
                source_path=clip,
                source_duration_seconds=12.0,
                trim_duration_seconds=scene.duration_seconds,
                start_seconds=round(start, 3),
                duration_seconds=scene.duration_seconds,
                transition=SceneTransition.CUT,
                geometry=ScaleCrop(
                    source_width=720,
                    source_height=1280,
                    scaled_width=1080,
                    scaled_height=1920,
                    crop_x=0,
                    crop_y=0,
                    output_width=1080,
                    output_height=1920,
                ),
            )
        )
        start += scene.duration_seconds

    captions = [
        CaptionCue(
            id=f"C-{index:02d}",
            scene_id=scene.id,
            text=scene.overlay_text,
            role=TextRole.CAPTION,
            start_seconds=scene.start_seconds,
            end_seconds=scene.end_seconds,
        )
        for index, scene in enumerate(storyboard_fixture.scenes, start=1)
        if scene.overlay_text
    ]
    return Composition(
        created_at=NOW,
        run_id="run-1",
        target_duration_seconds=40,
        timeline_duration_seconds=40.0,
        settings=settings,
        scenes=scenes,
        captions=captions,
        audio=AudioPlan(silent=True),
        font=FontInfo(
            family="DejaVuSans", path=Path("/usr/share/fonts/DejaVuSans.ttf"), sha256=ZERO
        ),
        source_sha256="a" * 64,
        storyboard_sha256=ZERO,
        narration_sha256=storyboard_fixture.narration_sha256,
        assets_sha256=ZERO,
        composition_sha256=ZERO,
        output_path=reel,
        development=True,
    )


def _names(report: object) -> set[str]:
    return {check.name for check in report.failures}  # type: ignore[attr-defined]


def test_a_correct_reel_passes(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    report = validate_reel(reel, composition, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert report.passed, report.failures
    assert len(report.checks) == 17


def test_a_missing_file_fails(
    tmp_path: Path,
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
):
    report = validate_reel(
        tmp_path / "absent.mp4", composition, storyboard_fixture, script_plan, _StubProbe(_info())
    )
    assert not report.passed
    assert "file_exists" in _names(report)


def test_an_unreadable_file_fails(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    report = validate_reel(
        reel, composition, storyboard_fixture, script_plan, _StubProbe(ProbeError("broken"))
    )
    assert not report.passed
    assert "file_is_readable" in _names(report)


@pytest.mark.parametrize(
    ("override", "failing"),
    [
        ({"width": 720, "height": 1280}, "resolution_matches_target"),
        ({"width": 1920, "height": 1080}, "aspect_ratio_is_portrait"),
        ({"duration_seconds": 36.0}, "duration_matches_storyboard"),
        ({"codec": "vp9"}, "video_codec_is_supported"),
        ({"has_audio_stream": False}, "audio_stream_exists"),
        ({"has_video_stream": False}, "video_stream_exists"),
    ],
)
def test_technical_faults_are_caught(
    reel: Path,
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    override: dict[str, object],
    failing: str,
):
    report = validate_reel(
        reel, composition, storyboard_fixture, script_plan, _StubProbe(_info(**override))
    )
    assert not report.passed
    assert failing in _names(report)


def test_a_rewritten_caption_fails(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    changed = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"text": "Лучшая платформа"}),
                *composition.captions[1:],
            ]
        }
    )
    report = validate_reel(reel, changed, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert not report.passed
    assert "captions_match_the_storyboard" in _names(report)


def test_a_placeholder_caption_fails(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    changed = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"text": "TODO caption"}),
                *composition.captions[1:],
            ]
        }
    )
    report = validate_reel(reel, changed, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert "no_placeholder_text" in _names(report)


def test_changed_narration_fails(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    changed = composition.model_copy(update={"narration_sha256": "b" * 64})
    report = validate_reel(reel, changed, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert not report.passed
    assert "narration_unchanged" in _names(report)


def test_a_dropped_scene_fails(
    reel: Path, composition: Composition, storyboard_fixture: Storyboard, script_plan: ScriptPlan
):
    changed = composition.model_copy(
        update={
            "scenes": composition.scenes[:-1],
            "timeline_duration_seconds": composition.scenes[-2].end_seconds,
        }
    )
    report = validate_reel(reel, changed, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert not report.passed
    assert "every_scene_is_represented" in _names(report)


def test_missing_footage_fails(
    reel: Path,
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    tmp_path: Path,
):
    changed = composition.model_copy(
        update={
            "scenes": [
                composition.scenes[0].model_copy(update={"source_path": tmp_path / "gone.mp4"}),
                *composition.scenes[1:],
            ]
        }
    )
    report = validate_reel(reel, changed, storyboard_fixture, script_plan, _StubProbe(_info()))
    assert "every_scene_has_footage" in _names(report)


def test_readiness_reports_what_is_missing(composition: Composition):
    checks = {check.name: check.passed for check in production_readiness(composition)}
    assert checks == {"narration_present": False, "approved_logo_applied": False}
