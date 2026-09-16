"""Validation of one generated asset file.

This is raw asset validation, not the Reel's quality gates: does the file
exist, is it real media, does it carry a video stream, and is it the thing the
storyboard asked for. Whether the footage *looks* right is a human judgement
this project does not pretend to automate.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.assets.identity import AssetRequest
from maingott_reel.assets.probe import MediaInfo, MediaProbe, ProbeError
from maingott_reel.models import ValidationCheck, ValidationReport

#: How far a generated clip may drift from the duration that was requested.
DURATION_TOLERANCE_SECONDS = 0.75

#: Files below this are never real footage.
MIN_ASSET_BYTES = 1024


def _check(name: str, passed: bool, detail: str | None = None) -> ValidationCheck:
    return ValidationCheck(name=name, passed=passed, detail=detail)


def validate_asset_file(
    path: Path,
    request: AssetRequest,
    probe: MediaProbe,
    created_at: datetime | None = None,
) -> tuple[ValidationReport, MediaInfo | None]:
    """Check a generated file against the request that produced it.

    Returns the report and, when the file could be inspected, its metadata.
    """
    checks: list[ValidationCheck] = []

    if not path.is_file():
        checks.append(_check("file_exists", False, f"{path} does not exist"))
        return _report(checks, created_at), None
    checks.append(_check("file_exists", True, str(path)))

    size = path.stat().st_size
    if size < MIN_ASSET_BYTES:
        checks.append(_check("file_is_not_empty", False, f"{size} bytes"))
        return _report(checks, created_at), None
    checks.append(_check("file_is_not_empty", True, f"{size} bytes"))

    try:
        info = probe.inspect(path)
    except ProbeError as error:
        checks.append(_check("media_is_readable", False, str(error)))
        return _report(checks, created_at), None
    checks.append(_check("media_is_readable", True, f"inspected with {info.tool}"))

    checks.append(
        _check(
            "video_stream_exists",
            info.has_video_stream,
            None if info.has_video_stream else "no video stream",
        )
    )
    checks.append(
        _check(
            "duration_is_positive",
            info.duration_seconds > 0,
            f"{info.duration_seconds}s",
        )
    )

    drift = abs(info.duration_seconds - request.generated_seconds)
    checks.append(
        _check(
            "duration_matches_request",
            drift <= DURATION_TOLERANCE_SECONDS,
            f"{info.duration_seconds}s for a {request.generated_seconds}s request",
        )
    )
    checks.append(
        _check(
            "covers_the_scene",
            info.duration_seconds + DURATION_TOLERANCE_SECONDS
            >= request.requested_duration_seconds,
            f"{info.duration_seconds}s for a {request.requested_duration_seconds}s scene",
        )
    )

    dimensions_ok = info.width > 0 and info.height > 0
    checks.append(_check("dimensions_are_present", dimensions_ok, f"{info.width}x{info.height}"))
    checks.append(
        _check(
            "dimensions_match_request",
            (info.width, info.height) == request.size,
            f"{info.width}x{info.height} for a {request.width}x{request.height} request",
        )
    )
    checks.append(_check("codec_is_present", bool(info.codec), info.codec or "unknown"))
    checks.append(
        _check(
            "frame_rate_is_valid",
            info.frame_rate is None or info.frame_rate > 0,
            None if info.frame_rate is None else f"{info.frame_rate} fps",
        )
    )
    return _report(checks, created_at), info


def _report(checks: list[ValidationCheck], created_at: datetime | None) -> ValidationReport:
    return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)


def failure_summary(report: ValidationReport) -> str:
    """One line naming what failed."""
    return "; ".join(f"{check.name}: {check.detail}" for check in report.failures)
