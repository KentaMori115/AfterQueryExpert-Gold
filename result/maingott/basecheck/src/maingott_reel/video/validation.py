"""Validating a composed Reel.

Two kinds of check, both deterministic: what the file *is* — resolution,
duration, codecs, streams, read back with ffprobe — and whether it is the Reel
the approved storyboard describes: every scene represented, in order, with the
approved captions and unchanged narration.

Whether the footage looks good remains a human judgement.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.assets.probe import MediaProbe, ProbeError
from maingott_reel.models import (
    DURATION_TOLERANCE_SECONDS,
    Composition,
    ScriptPlan,
    Storyboard,
    ValidationCheck,
    ValidationReport,
)

#: Placeholder markers that must never survive into a finished Reel.
PLACEHOLDER_MARKERS = ("TODO", "TBD", "FIXME", "lorem ipsum", "{{", "<placeholder>")

#: Codecs an Instagram Reel upload is expected to carry.
EXPECTED_VIDEO_CODECS = ("h264", "avc1")
EXPECTED_AUDIO_CODECS = ("aac",)


def _check(name: str, passed: bool, detail: str | None = None) -> ValidationCheck:
    return ValidationCheck(name=name, passed=passed, detail=detail)


def validate_reel(
    path: Path,
    composition: Composition,
    storyboard: Storyboard,
    plan: ScriptPlan,
    probe: MediaProbe,
    created_at: datetime | None = None,
) -> ValidationReport:
    """Check a finished Reel against the file it should be and the plan it came from."""
    checks: list[ValidationCheck] = []

    if not path.is_file():
        checks.append(_check("file_exists", False, f"{path} does not exist"))
        return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)
    checks.append(_check("file_exists", True, str(path)))

    size = path.stat().st_size
    checks.append(_check("file_is_not_empty", size > 1024, f"{size} bytes"))

    try:
        info = probe.inspect(path)
    except ProbeError as error:
        checks.append(_check("file_is_readable", False, str(error)))
        return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)
    checks.append(_check("file_is_readable", True, f"inspected with {info.tool}"))

    settings = composition.settings
    checks.append(_check("video_stream_exists", info.has_video_stream))
    checks.append(
        _check(
            "resolution_matches_target",
            (info.width, info.height) == (settings.width, settings.height),
            f"{info.width}x{info.height}, expected {settings.width}x{settings.height}",
        )
    )
    checks.append(
        _check(
            "aspect_ratio_is_portrait",
            info.height > info.width,
            f"{info.width}x{info.height}",
        )
    )
    drift = abs(info.duration_seconds - composition.timeline_duration_seconds)
    checks.append(
        _check(
            "duration_matches_storyboard",
            drift <= DURATION_TOLERANCE_SECONDS,
            f"{info.duration_seconds}s against a {composition.timeline_duration_seconds}s timeline",
        )
    )
    checks.append(
        _check(
            "frame_rate_is_valid",
            info.frame_rate is None or info.frame_rate > 0,
            None if info.frame_rate is None else f"{info.frame_rate} fps",
        )
    )
    checks.append(
        _check(
            "video_codec_is_supported",
            info.codec.lower() in EXPECTED_VIDEO_CODECS,
            info.codec or "unknown",
        )
    )
    checks.append(
        _check(
            "audio_stream_exists",
            info.has_audio_stream,
            "present" if info.has_audio_stream else "missing",
        )
    )

    # --- the Reel the storyboard describes ---------------------------------
    scene_ids = [scene.scene_id for scene in composition.scenes]
    checks.append(
        _check(
            "every_scene_is_represented",
            scene_ids == [scene.id for scene in storyboard.scenes],
            f"{len(scene_ids)} scenes",
        )
    )
    starts = [scene.start_seconds for scene in composition.scenes]
    checks.append(_check("scene_order_preserved", starts == sorted(starts)))

    approved = {scene.id: scene.overlay_text.strip() for scene in storyboard.scenes}
    mismatched = [
        cue.id for cue in composition.captions if cue.text != approved.get(cue.scene_id, "")
    ]
    checks.append(
        _check(
            "captions_match_the_storyboard",
            not mismatched,
            None if not mismatched else f"rewritten: {', '.join(mismatched)}",
        )
    )
    checks.append(
        _check(
            "narration_unchanged",
            composition.narration_sha256 == storyboard.narration_sha256,
            "storyboard and composition agree on the narration",
        )
    )
    placeholders = [
        cue.id
        for cue in composition.captions
        for marker in PLACEHOLDER_MARKERS
        if marker.lower() in cue.text.lower()
    ]
    checks.append(
        _check(
            "no_placeholder_text",
            not placeholders,
            None if not placeholders else ", ".join(placeholders),
        )
    )
    checks.append(
        _check(
            "every_scene_has_footage",
            all(scene.source_path.is_file() for scene in composition.scenes),
        )
    )
    checks.append(
        _check(
            "plan_and_storyboard_agree",
            plan.provenance.source_sha256 == composition.source_sha256,
            "same source specification",
        )
    )
    return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)


def production_readiness(composition: Composition) -> list[ValidationCheck]:
    """Report what still separates this Reel from a publishable one."""
    return [
        _check(
            "narration_present",
            not composition.audio.silent,
            "silent development audio" if composition.audio.silent else "narration mixed in",
        ),
        _check(
            "approved_logo_applied",
            composition.logo is not None,
            "no logo" if composition.logo is None else str(composition.logo.path),
        ),
    ]
