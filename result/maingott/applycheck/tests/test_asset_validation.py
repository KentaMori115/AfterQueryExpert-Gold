"""Validation of one generated file."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.identity import AssetRequest
from maingott_reel.assets.probe import ContainerProbe, MediaInfo, ProbeError
from maingott_reel.assets.validation import failure_summary, validate_asset_file
from maingott_reel.models import AssetType, DurationStrategy
from maingott_reel.providers.placeholder_video import write_placeholder_mp4


def _request(**overrides: object) -> AssetRequest:
    fields: dict[str, object] = {
        "scene_id": "S-01",
        "beat_id": "B-01",
        "asset_type": AssetType.VIDEO,
        "prompt": "A dark room where light converges into one calm core.",
        "provider": "fake",
        "model": "offline-video",
        "requested_duration_seconds": 3.83,
        "generated_seconds": 4,
        "width": 720,
        "height": 1280,
        "duration_strategy": DurationStrategy.TRIM_IN_POST,
        "source_sha256": "a" * 64,
        "prompt_version": "1/3",
    }
    fields.update(overrides)
    return AssetRequest(**fields)  # type: ignore[arg-type]


class _StubProbe:
    """A probe that returns whatever a test needs."""

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
        "duration_seconds": 4.0,
        "width": 720,
        "height": 1280,
        "codec": "h264",
        "frame_rate": 24.0,
        "has_video_stream": True,
        "has_audio_stream": False,
        "tool": "stub",
    }
    fields.update(overrides)
    return MediaInfo(**fields)  # type: ignore[arg-type]


def _names(report: object) -> set[str]:
    return {check.name for check in report.failures}  # type: ignore[attr-defined]


def _clip(tmp_path: Path, seconds: float = 4) -> Path:
    return write_placeholder_mp4(tmp_path / "video.mp4", seconds, 720, 1280)


# --- valid ----------------------------------------------------------------


def test_a_real_clip_passes(tmp_path: Path):
    report, info = validate_asset_file(_clip(tmp_path), _request(), ContainerProbe())
    assert report.passed, report.failures
    assert info is not None
    assert info.duration_seconds == 4.0


def test_every_check_is_reported(tmp_path: Path):
    report, _ = validate_asset_file(_clip(tmp_path), _request(), ContainerProbe())
    assert len(report.checks) == 11


# --- file level ------------------------------------------------------------


def test_a_missing_file_fails(tmp_path: Path):
    report, info = validate_asset_file(tmp_path / "absent.mp4", _request(), ContainerProbe())
    assert not report.passed
    assert "file_exists" in _names(report)
    assert info is None


def test_an_empty_file_fails(tmp_path: Path):
    path = tmp_path / "video.mp4"
    path.write_bytes(b"")
    report, _ = validate_asset_file(path, _request(), ContainerProbe())
    assert not report.passed
    assert "file_is_not_empty" in _names(report)


def test_a_truncated_download_fails(tmp_path: Path):
    clip = _clip(tmp_path)
    clip.write_bytes(clip.read_bytes()[:2000])
    report, _ = validate_asset_file(clip, _request(), ContainerProbe())
    assert not report.passed
    assert "media_is_readable" in _names(report)


def test_a_file_the_probe_cannot_read_fails(tmp_path: Path):
    report, _ = validate_asset_file(
        _clip(tmp_path), _request(), _StubProbe(ProbeError("no video stream"))
    )
    assert not report.passed
    assert "media_is_readable" in _names(report)


# --- media level ------------------------------------------------------------


def test_a_file_without_a_video_stream_fails(tmp_path: Path):
    probe = _StubProbe(_info(has_video_stream=False))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "video_stream_exists" in _names(report)


def test_a_clip_of_the_wrong_length_fails(tmp_path: Path):
    probe = _StubProbe(_info(duration_seconds=12.0))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "duration_matches_request" in _names(report)


def test_a_clip_too_short_for_its_scene_fails(tmp_path: Path):
    probe = _StubProbe(_info(duration_seconds=1.0))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "covers_the_scene" in _names(report)


def test_small_duration_drift_is_tolerated(tmp_path: Path):
    probe = _StubProbe(_info(duration_seconds=4.2))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert report.passed, report.failures


def test_missing_dimensions_fail(tmp_path: Path):
    probe = _StubProbe(_info(width=0, height=0))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "dimensions_are_present" in _names(report)


def test_dimensions_that_do_not_match_the_request_fail(tmp_path: Path):
    probe = _StubProbe(_info(width=1280, height=720))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "dimensions_match_request" in _names(report)


def test_a_missing_codec_fails(tmp_path: Path):
    probe = _StubProbe(_info(codec=""))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert not report.passed
    assert "codec_is_present" in _names(report)


def test_an_unknown_frame_rate_is_tolerated(tmp_path: Path):
    probe = _StubProbe(_info(frame_rate=None))
    report, _ = validate_asset_file(_clip(tmp_path), _request(), probe)
    assert report.passed, report.failures


def test_failures_are_summarised(tmp_path: Path):
    report, _ = validate_asset_file(tmp_path / "absent.mp4", _request(), ContainerProbe())
    assert "file_exists" in failure_summary(report)


@pytest.mark.parametrize("seconds", [4, 8, 12])
def test_each_supported_clip_length_validates(tmp_path: Path, seconds: int):
    clip = write_placeholder_mp4(tmp_path / "v.mp4", seconds, 720, 1280)
    request = _request(generated_seconds=seconds, requested_duration_seconds=seconds - 0.5)
    report, _ = validate_asset_file(clip, request, ContainerProbe())
    assert report.passed, report.failures
