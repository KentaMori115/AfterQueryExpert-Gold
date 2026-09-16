"""Deterministic validation of a generated narration track."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.probe import ProbeError
from maingott_reel.audio.identity import VoiceRequest
from maingott_reel.audio.probe import AudioInfo, WavProbe
from maingott_reel.audio.validation import (
    MIN_VOICE_BYTES,
    expected_rate,
    fit_speed,
    speech_metrics,
    validate_voice_file,
)
from maingott_reel.audio.wav import tone_samples, write_wav
from maingott_reel.models import AudioFormat, Language, ValidationReport
from maingott_reel.utils.hashing import sha256_file, sha256_text

# 540 characters: about 36 seconds of Russian at the expected rate.
NARRATION = "Клиенты приходят из разных каналов. MainGott соединяет их в одну платформу. " * 7


def _request(**overrides: object) -> VoiceRequest:
    fields: dict[str, object] = {
        "narration": NARRATION,
        "provider": "openai",
        "model": "gpt-4o-mini-tts",
        "voice": "marin",
        "language": Language.RU,
        "audio_format": AudioFormat.WAV,
        "storyboard_sha256": "b" * 64,
        "source_sha256": "a" * 64,
        "target_duration_seconds": 40.0,
    }
    fields.update(overrides)
    return VoiceRequest(**fields)  # type: ignore[arg-type]


def _track(tmp_path: Path, seconds: float = 36.0) -> Path:
    return write_wav(
        tmp_path / "voice.wav", tone_samples(seconds, 24000), sample_rate=24000, channels=1
    )


class _BrokenProbe:
    name = "broken"

    def inspect_audio(self, path: Path) -> AudioInfo:
        raise ProbeError("the audio could not be decoded")


class _StubProbe:
    name = "stub"

    def __init__(self, info: AudioInfo) -> None:
        self._info = info

    def inspect_audio(self, path: Path) -> AudioInfo:
        return self._info


def _validate(
    path: Path,
    request: VoiceRequest | None = None,
    probe: object | None = None,
    **kw: object,
) -> tuple[ValidationReport, AudioInfo | None]:
    resolved = request or _request()
    return validate_voice_file(
        path,
        resolved,
        probe or WavProbe(),  # type: ignore[arg-type]
        kw.pop("expected", resolved.narration_sha256),
        **kw,
    )


# --- the happy path -------------------------------------------------------------


def test_a_good_track_passes_every_check(tmp_path: Path):
    report, info = _validate(_track(tmp_path))

    assert report.passed, [check.name for check in report.failures]
    assert info is not None
    assert info.duration_seconds == pytest.approx(36.0, abs=0.05)
    names = {check.name for check in report.checks}
    assert {
        "narration_matches_the_plan",
        "file_exists",
        "audio_is_readable",
        "audio_stream_exists",
        "duration_is_positive",
        "narration_fits_the_timeline",
        "speech_rate_is_reasonable",
    } <= names


# --- what it must say -------------------------------------------------------------


def test_a_track_generated_from_different_words_fails(tmp_path: Path):
    report, _ = _validate(_track(tmp_path), expected=sha256_text("совсем другой текст"))

    assert not report.passed
    failure = next(c for c in report.failures if c.name == "narration_matches_the_plan")
    assert "the plan approved" in (failure.detail or "")


# --- the file itself ----------------------------------------------------------------


def test_a_missing_file_fails(tmp_path: Path):
    report, info = _validate(tmp_path / "absent.wav")
    assert info is None
    assert not report.passed
    assert any(check.name == "file_exists" for check in report.failures)


def test_an_empty_file_fails(tmp_path: Path):
    path = tmp_path / "voice.wav"
    path.write_bytes(b"\x00" * (MIN_VOICE_BYTES - 1))
    report, info = _validate(path)
    assert info is None
    assert any(check.name == "file_is_not_empty" for check in report.failures)


def test_a_corrupt_file_fails(tmp_path: Path):
    path = tmp_path / "voice.wav"
    path.write_bytes(b"\x00" * 4096)
    report, info = _validate(path)
    assert info is None
    assert any(check.name == "audio_is_readable" for check in report.failures)


def test_an_unreadable_file_is_reported(tmp_path: Path):
    report, info = _validate(_track(tmp_path), probe=_BrokenProbe())
    assert info is None
    assert any("decoded" in (check.detail or "") for check in report.failures)


def test_a_changed_file_fails_its_recorded_hash(tmp_path: Path):
    path = _track(tmp_path)
    digest = sha256_file(path)
    path.write_bytes(path.read_bytes() + b"\x00\x00")

    report, _ = _validate(path, recorded_sha256=digest)
    assert any(check.name == "file_matches_its_hash" for check in report.failures)


def test_an_unchanged_file_matches_its_recorded_hash(tmp_path: Path):
    path = _track(tmp_path)
    report, _ = _validate(path, recorded_sha256=sha256_file(path))
    assert report.passed


def test_a_file_that_is_far_too_small_for_its_duration_fails(tmp_path: Path):
    path = _track(tmp_path, seconds=36.0)
    info = AudioInfo(
        duration_seconds=36.0, sample_rate=24000, channels=1, codec="pcm_s16le", tool="stub"
    )
    tiny = tmp_path / "tiny.wav"
    tiny.write_bytes(b"\x00" * 4096)
    report, _ = validate_voice_file(tiny, _request(), _StubProbe(info), _request().narration_sha256)
    assert any(check.name == "audio_is_not_a_placeholder_file" for check in report.failures)
    assert path.is_file()


def test_a_video_stream_in_the_narration_is_refused(tmp_path: Path):
    info = AudioInfo(
        duration_seconds=36.0,
        sample_rate=24000,
        channels=1,
        codec="pcm_s16le",
        tool="stub",
        video_streams=1,
    )
    report, _ = validate_voice_file(
        _track(tmp_path), _request(), _StubProbe(info), _request().narration_sha256
    )
    assert any(check.name == "no_video_stream" for check in report.failures)


def test_a_codec_that_does_not_match_the_request_is_reported(tmp_path: Path):
    info = AudioInfo(
        duration_seconds=36.0, sample_rate=24000, channels=1, codec="mp3", tool="ffprobe"
    )
    report, _ = validate_voice_file(
        _track(tmp_path), _request(), _StubProbe(info), _request().narration_sha256
    )
    assert any(check.name == "codec_matches_the_requested_format" for check in report.failures)


# --- timing ---------------------------------------------------------------------------


def test_narration_that_overruns_the_timeline_fails(tmp_path: Path):
    report, _ = _validate(_track(tmp_path, seconds=44.0))
    failure = next(c for c in report.failures if c.name == "narration_fits_the_timeline")
    assert "44" in (failure.detail or "")


def test_narration_a_hair_over_the_timeline_is_tolerated(tmp_path: Path):
    report, _ = _validate(_track(tmp_path, seconds=40.1))
    assert all(check.name != "narration_fits_the_timeline" for check in report.failures)


def test_speech_that_is_far_too_fast_is_reported(tmp_path: Path):
    report, _ = _validate(_track(tmp_path, seconds=8.0))
    assert any(check.name == "speech_rate_is_reasonable" for check in report.failures)


def test_speech_that_is_far_too_slow_is_reported(tmp_path: Path):
    request = _request(target_duration_seconds=120.0)
    report, _ = _validate(_track(tmp_path, seconds=110.0), request=request)
    assert any(check.name == "speech_rate_is_reasonable" for check in report.failures)


def test_metrics_describe_the_delivery():
    metrics = speech_metrics(_request(), duration_seconds=36.0)
    assert metrics.characters == len(NARRATION)
    assert metrics.words == len(NARRATION.split())
    assert metrics.characters_per_second == pytest.approx(len(NARRATION) / 36.0, abs=0.01)
    assert metrics.words_per_minute == pytest.approx(len(NARRATION.split()) / 36 * 60, abs=0.1)
    assert metrics.headroom_seconds == 4.0
    assert metrics.fits_timeline


def test_the_expected_rate_is_language_specific():
    assert expected_rate(Language.RU) == 15.0
    assert expected_rate(Language.EN) == 17.0


def test_the_fitting_speed_covers_the_overrun():
    speed = fit_speed(measured_seconds=44.0, target_seconds=40.0)
    assert speed > 1.0
    assert 44.0 / speed <= 40.0


def test_the_fitting_speed_is_safe_on_nonsense():
    assert fit_speed(0.0, 40.0) == 1.0
    assert fit_speed(40.0, 0.0) == 1.0
