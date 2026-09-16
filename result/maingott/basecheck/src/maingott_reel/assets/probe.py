"""Inspecting generated media files.

Two implementations of the same contract:

:class:`FFProbe`
    shells out to ``ffprobe`` — the authoritative answer, and what the quality
    gates use when FFmpeg is installed;
:class:`ContainerProbe`
    reads the MP4 container directly, so asset validation still has teeth on a
    machine without FFmpeg. It verifies structure, not decodability.

The probe is injected, so tests never depend on what is installed locally.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from maingott_reel.assets.mp4 import Mp4Error, parse_mp4
from maingott_reel.logging_config import get_logger

logger = get_logger("assets.probe")

#: How long to let ffprobe run on one file.
PROBE_TIMEOUT_SECONDS = 60


class ProbeError(RuntimeError):
    """The file could not be inspected."""


@dataclass(frozen=True)
class MediaInfo:
    """What a probe could determine about a media file."""

    duration_seconds: float
    width: int
    height: int
    codec: str
    frame_rate: float | None
    has_video_stream: bool
    has_audio_stream: bool
    tool: str
    video_streams: int = 0
    audio_streams: int = 0
    other_streams: int = 0


@runtime_checkable
class MediaProbe(Protocol):
    """Reads technical metadata from a media file."""

    @property
    def name(self) -> str:
        """Identifier recorded with validation results."""
        ...

    def inspect(self, path: Path) -> MediaInfo:
        """Return the file's technical metadata.

        Raises:
            ProbeError: the file cannot be inspected.
        """
        ...


def parse_ffprobe(payload: dict[str, Any]) -> MediaInfo:
    """Convert ffprobe's JSON output into :class:`MediaInfo`.

    Raises:
        ProbeError: the output carries no usable video stream.
    """
    streams = payload.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None:
        raise ProbeError("the file contains no video stream")

    duration = _first_float(video.get("duration"), (payload.get("format") or {}).get("duration"))
    if duration is None:
        raise ProbeError("the file declares no duration")

    kinds = [stream.get("codec_type") for stream in streams]
    return MediaInfo(
        duration_seconds=round(duration, 3),
        width=int(video.get("width") or 0),
        height=int(video.get("height") or 0),
        codec=str(video.get("codec_name") or ""),
        frame_rate=_parse_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        has_video_stream=True,
        has_audio_stream=audio is not None,
        tool="ffprobe",
        video_streams=kinds.count("video"),
        audio_streams=kinds.count("audio"),
        other_streams=sum(1 for kind in kinds if kind not in ("video", "audio")),
    )


def _first_float(*values: Any) -> float | None:
    """Return the first value that parses as a positive float."""
    for value in values:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def _parse_rate(value: Any) -> float | None:
    """Parse an ffprobe frame rate such as ``30000/1001``."""
    if not value or not isinstance(value, str):
        return None
    numerator, _, denominator = value.partition("/")
    try:
        rate = float(numerator) / float(denominator or 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return round(rate, 3) if rate > 0 else None


class FFProbe:
    """Media inspection through the ``ffprobe`` binary."""

    def __init__(self, binary: str = "ffprobe") -> None:
        """Store the binary to call."""
        self._binary = binary

    @property
    def name(self) -> str:
        """Identifier recorded with validation results."""
        return "ffprobe"

    def is_available(self) -> bool:
        """Whether the binary can be found."""
        return shutil.which(self._binary) is not None

    def inspect(self, path: Path) -> MediaInfo:
        """Run ffprobe against ``path``.

        Raises:
            ProbeError: ffprobe is missing, failed, or returned nothing usable.
        """
        if not path.is_file():
            raise ProbeError(f"file does not exist: {path}")
        command = [
            self._binary,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
        try:
            completed = subprocess.run(  # fixed command; only the path varies
                command,
                capture_output=True,
                text=True,
                timeout=PROBE_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError as error:
            raise ProbeError(f"{self._binary} is not installed") from error
        except subprocess.TimeoutExpired as error:
            raise ProbeError(f"{self._binary} timed out on {path.name}") from error

        if completed.returncode != 0:
            raise ProbeError(f"{self._binary} failed: {completed.stderr.strip()[:200]}")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise ProbeError(f"{self._binary} returned unreadable output") from error
        return parse_ffprobe(payload)


class ContainerProbe:
    """Media inspection by reading the MP4 container."""

    @property
    def name(self) -> str:
        """Identifier recorded with validation results."""
        return "container"

    def inspect(self, path: Path) -> MediaInfo:
        """Read ``path``'s container structure.

        Raises:
            ProbeError: the file is not a usable MP4 container.
        """
        try:
            info = parse_mp4(path)
        except Mp4Error as error:
            raise ProbeError(str(error)) from error
        if not info.has_media_data:
            raise ProbeError("the container declares no media data")
        return MediaInfo(
            duration_seconds=info.duration_seconds,
            width=info.width,
            height=info.height,
            codec=info.codec,
            frame_rate=info.frame_rate,
            has_video_stream=info.has_video_track,
            has_audio_stream=False,
            tool="container",
            video_streams=1 if info.has_video_track else 0,
        )


def default_probe(ffprobe_binary: str = "ffprobe") -> MediaProbe:
    """Return ffprobe when it is installed, else the container reader."""
    ffprobe = FFProbe(ffprobe_binary)
    if ffprobe.is_available():
        return ffprobe
    logger.warning(
        "ffprobe is not installed; falling back to container inspection",
        extra={"binary": ffprobe_binary},
    )
    return ContainerProbe()
