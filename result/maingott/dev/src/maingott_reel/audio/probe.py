"""Inspecting generated audio.

The same contract as :mod:`maingott_reel.assets.probe`, for files that carry
no video track:

:class:`FFAudioProbe`
    shells out to ``ffprobe`` — the authoritative answer, and what the voice
    gates use when FFmpeg is installed;
:class:`WavProbe`
    reads the RIFF header directly, so narration validation still has teeth on
    a machine without FFmpeg. It verifies structure, not decodability.

The probe is injected, so tests never depend on what is installed locally.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from maingott_reel.assets.probe import PROBE_TIMEOUT_SECONDS, ProbeError
from maingott_reel.audio.wav import WavError, parse_wav
from maingott_reel.logging_config import get_logger

logger = get_logger("audio.probe")


@dataclass(frozen=True)
class AudioInfo:
    """What a probe could determine about an audio file."""

    duration_seconds: float
    sample_rate: int
    channels: int
    codec: str
    tool: str
    audio_streams: int = 1
    video_streams: int = 0
    other_streams: int = 0
    bit_rate: int | None = None


@runtime_checkable
class AudioProbe(Protocol):
    """Reads technical metadata from an audio file."""

    @property
    def name(self) -> str:
        """Identifier recorded with validation results."""
        ...

    def inspect_audio(self, path: Path) -> AudioInfo:
        """Return the file's technical metadata.

        Raises:
            ProbeError: the file cannot be inspected.
        """
        ...


def parse_ffprobe_audio(payload: dict[str, Any]) -> AudioInfo:
    """Convert ffprobe's JSON output into :class:`AudioInfo`.

    Raises:
        ProbeError: the output carries no usable audio stream.
    """
    streams = payload.get("streams") or []
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if audio is None:
        raise ProbeError("the file contains no audio stream")

    duration = _first_float(audio.get("duration"), (payload.get("format") or {}).get("duration"))
    if duration is None:
        raise ProbeError("the file declares no duration")

    kinds = [stream.get("codec_type") for stream in streams]
    rate = int(audio.get("sample_rate") or 0)
    channels = int(audio.get("channels") or 0)
    if rate <= 0 or channels <= 0:
        raise ProbeError("the audio stream declares no usable rate or channel count")
    bit_rate = _first_float(audio.get("bit_rate"), (payload.get("format") or {}).get("bit_rate"))
    return AudioInfo(
        duration_seconds=round(duration, 3),
        sample_rate=rate,
        channels=channels,
        codec=str(audio.get("codec_name") or ""),
        tool="ffprobe",
        audio_streams=kinds.count("audio"),
        video_streams=kinds.count("video"),
        other_streams=sum(1 for kind in kinds if kind not in ("video", "audio")),
        bit_rate=int(bit_rate) if bit_rate else None,
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


class FFAudioProbe:
    """Audio inspection through the ``ffprobe`` binary."""

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

    def inspect_audio(self, path: Path) -> AudioInfo:
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
        return parse_ffprobe_audio(payload)


class WavProbe:
    """Audio inspection by reading the RIFF header."""

    @property
    def name(self) -> str:
        """Identifier recorded with validation results."""
        return "wav"

    def inspect_audio(self, path: Path) -> AudioInfo:
        """Read ``path``'s container structure.

        Raises:
            ProbeError: the file is not a usable WAV container.
        """
        try:
            info = parse_wav(path)
        except WavError as error:
            raise ProbeError(str(error)) from error
        if info.frames == 0:
            raise ProbeError("the container holds no audio frames")
        return AudioInfo(
            duration_seconds=info.duration_seconds,
            sample_rate=info.sample_rate,
            channels=info.channels,
            codec=f"pcm_s{info.bits_per_sample}le",
            tool="wav",
        )


def default_audio_probe(ffprobe_binary: str = "ffprobe") -> AudioProbe:
    """Return ffprobe when it is installed, else the WAV header reader."""
    ffprobe = FFAudioProbe(ffprobe_binary)
    if ffprobe.is_available():
        return ffprobe
    logger.warning(
        "ffprobe is not installed; falling back to WAV header inspection",
        extra={"binary": ffprobe_binary},
    )
    return WavProbe()
