"""Reading and writing WAV files without a decoder.

Narration is generated as WAV, so the pipeline needs to be able to answer
basic questions about one — how long is it, what rate, how many channels —
even on a machine without FFmpeg, and to write a real one for the offline
provider. Both are small enough to do exactly rather than approximately.

This module understands linear PCM only: that is what the pipeline generates
and what it validates. Anything else is reported as unreadable rather than
guessed at.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path

#: PCM format tag in a WAV ``fmt `` chunk.
PCM_FORMAT = 1

#: Longest header the parser will walk before giving up on a malformed file.
MAX_CHUNKS = 64


class WavError(ValueError):
    """The file is not a WAV file this module can read."""


@dataclass(frozen=True)
class WavInfo:
    """What the RIFF header says about a WAV file."""

    sample_rate: int
    channels: int
    bits_per_sample: int
    frames: int
    data_bytes: int

    @property
    def duration_seconds(self) -> float:
        """Length of the audio, in seconds."""
        return round(self.frames / self.sample_rate, 3) if self.sample_rate else 0.0


def parse_wav(path: Path) -> WavInfo:
    """Read ``path``'s RIFF header.

    Raises:
        WavError: the file is missing, truncated, or not linear PCM.
    """
    try:
        raw = path.read_bytes()
    except OSError as error:  # pragma: no cover - filesystem failure
        raise WavError(f"cannot read {path}: {error}") from error

    if len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise WavError("the file is not a RIFF/WAVE container")

    offset = 12
    fmt: tuple[int, int, int, int] | None = None
    data_bytes: int | None = None
    for _ in range(MAX_CHUNKS):
        if offset + 8 > len(raw):
            break
        chunk_id = raw[offset : offset + 4]
        (size,) = struct.unpack("<I", raw[offset + 4 : offset + 8])
        body = raw[offset + 8 : offset + 8 + size]
        if chunk_id == b"fmt " and len(body) >= 16:
            tag, channels, rate, _byte_rate, _align, bits = struct.unpack("<HHIIHH", body[:16])
            fmt = (tag, channels, rate, bits)
        elif chunk_id == b"data":
            # Trust the file's length, not the declared size: a truncated file
            # must report what is actually there.
            data_bytes = min(size, max(len(raw) - offset - 8, 0))
        offset += 8 + size + (size % 2)

    if fmt is None:
        raise WavError("the container declares no format chunk")
    if data_bytes is None:
        raise WavError("the container declares no audio data")
    tag, channels, rate, bits = fmt
    if tag != PCM_FORMAT:
        raise WavError(f"unsupported WAV format tag {tag}; only linear PCM is understood")
    if channels <= 0 or rate <= 0 or bits <= 0:
        raise WavError("the format chunk declares no usable audio")

    block = channels * bits // 8
    if block <= 0:
        raise WavError("the format chunk declares a zero-length frame")
    return WavInfo(
        sample_rate=rate,
        channels=channels,
        bits_per_sample=bits,
        frames=data_bytes // block,
        data_bytes=data_bytes,
    )


def write_wav(
    path: Path,
    samples: bytes,
    sample_rate: int,
    channels: int = 1,
    bits_per_sample: int = 16,
) -> Path:
    """Write linear PCM ``samples`` as a WAV file.

    Raises:
        ValueError: the parameters do not describe writable audio.
    """
    if sample_rate <= 0 or channels <= 0 or bits_per_sample not in (8, 16, 24, 32):
        raise ValueError("a WAV file needs a positive rate, channel count and known bit depth")
    if not samples:
        raise ValueError("refusing to write a WAV file with no audio data")

    block_align = channels * bits_per_sample // 8
    byte_rate = sample_rate * block_align
    fmt_chunk = struct.pack(
        "<4sIHHIIHH",
        b"fmt ",
        16,
        PCM_FORMAT,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
    )
    data_chunk = struct.pack("<4sI", b"data", len(samples)) + samples
    body = b"WAVE" + fmt_chunk + data_chunk
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<4sI", b"RIFF", len(body)) + body)
    return path


def tone_samples(
    seconds: float,
    sample_rate: int,
    frequency: float = 174.0,
    amplitude: float = 0.06,
    cadence: float = 2.6,
) -> bytes:
    """Build a deterministic 16-bit mono waveform.

    A quiet, slowly pulsing tone: it occupies the same seconds real narration
    would and is unmistakably not a voice. Identical arguments always produce
    identical bytes.

    Raises:
        ValueError: the requested audio has no duration.
    """
    if seconds <= 0:
        raise ValueError("a placeholder track needs a positive duration")
    frames = max(1, round(seconds * sample_rate))
    peak = int(32767 * min(max(amplitude, 0.0), 1.0))
    step = 2 * math.pi * frequency / sample_rate
    pulse = 2 * math.pi * cadence / sample_rate
    return b"".join(
        struct.pack(
            "<h",
            int(peak * math.sin(step * index) * (0.55 + 0.45 * math.sin(pulse * index))),
        )
        for index in range(frames)
    )
