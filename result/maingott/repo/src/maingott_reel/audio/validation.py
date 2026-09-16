"""Validation of one generated narration track.

Raw audio validation, not the Reel's quality gates: does the file exist, is it
real audio, does it speak the narration the plan approved, and can it be heard
in full inside the storyboard's timeline. Whether the delivery *sounds* right
is a human judgement this project does not pretend to automate.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.assets.probe import ProbeError
from maingott_reel.audio.identity import VoiceRequest
from maingott_reel.audio.probe import AudioInfo, AudioProbe
from maingott_reel.creative.claims import SPEECH_RATE_CPS
from maingott_reel.models import (
    TIMELINE_TOLERANCE_SECONDS,
    AudioFormat,
    Language,
    SpeechMetrics,
    ValidationCheck,
    ValidationReport,
)
from maingott_reel.utils.hashing import sha256_file

#: Files below this are never real speech.
MIN_VOICE_BYTES = 1024

#: Even the most compressed speech carries more than this per second.
MIN_BYTES_PER_SECOND = 400

#: How far the measured speaking rate may sit from the language's expected
#: rate before the delivery is too rushed or too laboured to accept.
MIN_RATE_FACTOR = 0.55
MAX_RATE_FACTOR = 1.45

#: Codecs each requested format may legitimately come back as.
EXPECTED_CODECS: dict[AudioFormat, tuple[str, ...]] = {
    AudioFormat.WAV: ("pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"),
    AudioFormat.PCM: ("pcm_s16le", "pcm_s24le"),
    AudioFormat.FLAC: ("flac",),
    AudioFormat.MP3: ("mp3", "mp3float"),
    AudioFormat.AAC: ("aac",),
    AudioFormat.OPUS: ("opus", "libopus"),
}


def _check(name: str, passed: bool, detail: str | None = None) -> ValidationCheck:
    return ValidationCheck(name=name, passed=passed, detail=detail)


def expected_rate(language: Language) -> float:
    """Spoken characters per second expected of ``language``."""
    return SPEECH_RATE_CPS[language]


def speech_metrics(request: VoiceRequest, duration_seconds: float) -> SpeechMetrics:
    """Measure how fast the generated narration actually speaks."""
    return SpeechMetrics(
        characters=request.characters,
        words=request.words,
        duration_seconds=duration_seconds,
        timeline_seconds=request.target_duration_seconds,
    )


def validate_voice_file(
    path: Path,
    request: VoiceRequest,
    probe: AudioProbe,
    expected_narration_sha256: str,
    recorded_sha256: str | None = None,
    created_at: datetime | None = None,
) -> tuple[ValidationReport, AudioInfo | None]:
    """Check a generated track against the request that produced it.

    Returns the report and, when the file could be inspected, its metadata.
    """
    checks: list[ValidationCheck] = []

    # --- what it must say, checked before the file is even opened ----------
    matches = request.narration_sha256 == expected_narration_sha256
    checks.append(
        _check(
            "narration_matches_the_plan",
            matches,
            f"sha256 {request.narration_sha256[:12]}"
            if matches
            else f"the track speaks {request.narration_sha256[:12]}, "
            f"the plan approved {expected_narration_sha256[:12]}",
        )
    )

    if not path.is_file():
        checks.append(_check("file_exists", False, f"{path} does not exist"))
        return _report(checks, created_at), None
    checks.append(_check("file_exists", True, str(path)))

    size = path.stat().st_size
    if size < MIN_VOICE_BYTES:
        checks.append(_check("file_is_not_empty", False, f"{size} bytes"))
        return _report(checks, created_at), None
    checks.append(_check("file_is_not_empty", True, f"{size} bytes"))

    if recorded_sha256 is not None:
        digest = sha256_file(path)
        checks.append(
            _check(
                "file_matches_its_hash",
                digest == recorded_sha256,
                f"sha256 {digest[:12]}"
                if digest == recorded_sha256
                else "the file changed after it was recorded",
            )
        )

    try:
        info = probe.inspect_audio(path)
    except ProbeError as error:
        checks.append(_check("audio_is_readable", False, str(error)))
        return _report(checks, created_at), None
    checks.append(_check("audio_is_readable", True, f"inspected with {info.tool}"))

    checks.append(
        _check(
            "audio_stream_exists",
            info.audio_streams >= 1,
            f"{info.audio_streams} audio streams",
        )
    )
    checks.append(
        _check("no_video_stream", info.video_streams == 0, f"{info.video_streams} video streams")
    )
    checks.append(
        _check("duration_is_positive", info.duration_seconds > 0, f"{info.duration_seconds}s")
    )
    checks.append(_check("sample_rate_is_present", info.sample_rate > 0, f"{info.sample_rate} Hz"))
    checks.append(_check("channels_are_present", info.channels >= 1, f"{info.channels} channels"))

    expected = EXPECTED_CODECS.get(request.audio_format, ())
    codec_ok = not expected or info.codec.lower() in expected or info.tool == "wav"
    checks.append(
        _check(
            "codec_matches_the_requested_format",
            codec_ok,
            f"{info.codec or 'unknown'} for a {request.audio_format.value} request",
        )
    )

    density = size / info.duration_seconds if info.duration_seconds else 0.0
    checks.append(
        _check(
            "audio_is_not_a_placeholder_file",
            density >= MIN_BYTES_PER_SECOND,
            f"{density:.0f} bytes per second",
        )
    )

    metrics = speech_metrics(request, info.duration_seconds)
    checks.append(
        _check(
            "narration_fits_the_timeline",
            metrics.fits_timeline,
            f"{metrics.duration_seconds}s of speech in a {metrics.timeline_seconds}s timeline "
            f"({metrics.headroom_seconds:+.2f}s)",
        )
    )
    baseline = expected_rate(request.language)
    rate_ok = (
        baseline * MIN_RATE_FACTOR <= metrics.characters_per_second <= (baseline * MAX_RATE_FACTOR)
    )
    checks.append(
        _check(
            "speech_rate_is_reasonable",
            rate_ok,
            f"{metrics.characters_per_second} characters per second "
            f"({metrics.words_per_minute} wpm), expected around {baseline} for "
            f"{request.language.value}",
        )
    )
    return _report(checks, created_at), info


def _report(checks: list[ValidationCheck], created_at: datetime | None) -> ValidationReport:
    return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)


def failure_summary(report: ValidationReport) -> str:
    """One line naming what failed."""
    return "; ".join(f"{check.name}: {check.detail}" for check in report.failures)


def fit_speed(measured_seconds: float, target_seconds: float) -> float:
    """Return the speaking speed that would make the narration fit.

    Speeding speech up by the ratio it overruns by is the only adjustment this
    project makes, and it is applied by regenerating — the words never change.
    """
    if measured_seconds <= 0 or target_seconds <= 0:
        return 1.0
    # A little margin so the regenerated take lands inside the timeline
    # rather than exactly on its edge.
    return round(measured_seconds / (target_seconds - TIMELINE_TOLERANCE_SECONDS), 3)
