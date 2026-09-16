"""Writing placeholder MP4 files.

The offline video provider needs to hand the pipeline a file that behaves like
generated footage: a real MP4 container with a movie header, a video track of
the right size and duration, and media data. This module writes one.

Two ways to make one. With FFmpeg installed, a real clip is encoded from a
colour source, so the file genuinely decodes and can be composed. Without
FFmpeg, the container is written by hand: structurally valid, but the sample
data is filler and no encoder is involved, so it does not decode.

Either way these are placeholders standing in for generated footage, not
footage. Never ship one in a Reel.
"""

from __future__ import annotations

import struct
from pathlib import Path

from maingott_reel.utils.ffmpeg import FFmpeg
from maingott_reel.utils.hashing import sha256_text

#: Movie timescale. 90 kHz divides the usual frame rates exactly, so a clip's
#: duration comes out as the requested number of seconds rather than near it.
TIMESCALE = 90000

#: Bytes of filler per frame. Enough that a clip clears the "not empty" bar.
BYTES_PER_FRAME = 256


def _box(box_type: bytes, payload: bytes) -> bytes:
    """Wrap a payload in an MP4 box header."""
    return struct.pack(">I", len(payload) + 8) + box_type + payload


def _ftyp() -> bytes:
    return _box(b"ftyp", b"isom" + struct.pack(">I", 512) + b"isomiso2mp41")


def _mvhd(duration_units: int) -> bytes:
    payload = struct.pack(
        ">IIIII",
        0,  # version and flags
        0,  # creation time
        0,  # modification time
        TIMESCALE,
        duration_units,
    )
    payload += struct.pack(">I", 0x00010000)  # rate
    payload += struct.pack(">H", 0x0100)  # volume
    payload += b"\x00" * 10  # reserved
    payload += struct.pack(
        ">9i", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000
    )  # unity matrix
    payload += b"\x00" * 24  # predefined
    payload += struct.pack(">I", 2)  # next track id
    return _box(b"mvhd", payload)


def _tkhd(duration_units: int, width: int, height: int) -> bytes:
    payload = struct.pack(
        ">IIIIII",
        0x00000003,  # version 0, flags: enabled and in movie
        0,
        0,
        1,  # track id
        0,  # reserved
        duration_units,
    )
    payload += b"\x00" * 8  # reserved
    payload += struct.pack(">hhhh", 0, 0, 0, 0)  # layer, group, volume, reserved
    payload += struct.pack(">9i", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)
    payload += struct.pack(">II", width << 16, height << 16)
    return _box(b"tkhd", payload)


def _mdhd(duration_units: int) -> bytes:
    payload = struct.pack(">IIIII", 0, 0, 0, TIMESCALE, duration_units)
    payload += struct.pack(">HH", 0x55C4, 0)  # language 'und', predefined
    return _box(b"mdhd", payload)


def _hdlr() -> bytes:
    payload = struct.pack(">I", 0) + b"\x00" * 4 + b"vide" + b"\x00" * 12
    payload += b"MainGott placeholder\x00"
    return _box(b"hdlr", payload)


def _vmhd() -> bytes:
    return _box(b"vmhd", struct.pack(">IHHHH", 1, 0, 0, 0, 0))


def _dinf() -> bytes:
    url = _box(b"url ", struct.pack(">I", 1))
    dref = _box(b"dref", struct.pack(">II", 0, 1) + url)
    return _box(b"dinf", dref)


def _stsd(width: int, height: int) -> bytes:
    entry = b"\x00" * 6 + struct.pack(">H", 1)  # reserved, data reference index
    entry += b"\x00" * 16  # predefined and reserved
    entry += struct.pack(">HH", width, height)
    entry += struct.pack(">II", 0x00480000, 0x00480000)  # 72 dpi resolution
    entry += struct.pack(">I", 0)  # reserved
    entry += struct.pack(">H", 1)  # frame count
    entry += b"\x00" * 32  # compressor name
    entry += struct.pack(">Hh", 24, -1)  # depth, predefined
    return _box(b"stsd", struct.pack(">II", 0, 1) + _box(b"avc1", entry))


def _stts(frames: int, frame_duration: int) -> bytes:
    return _box(b"stts", struct.pack(">IIII", 0, 1, frames, frame_duration))


def _stsc() -> bytes:
    return _box(b"stsc", struct.pack(">IIIII", 0, 1, 1, 1, 1))


def _stsz(frames: int, frame_bytes: int) -> bytes:
    return _box(b"stsz", struct.pack(">III", 0, frame_bytes, frames))


def _stco(offset: int) -> bytes:
    return _box(b"stco", struct.pack(">III", 0, 1, offset))


def write_placeholder_mp4(
    path: Path,
    seconds: float,
    width: int,
    height: int,
    frame_rate: int = 24,
    seed: bytes = b"maingott",
) -> Path:
    """Write a structurally valid placeholder MP4 to ``path``.

    The file is deterministic: identical arguments produce identical bytes.

    Raises:
        ValueError: the requested clip has no duration or no size.
    """
    if seconds <= 0:
        raise ValueError("a placeholder clip needs a positive duration")
    if width <= 0 or height <= 0:
        raise ValueError("a placeholder clip needs positive dimensions")

    frames = max(1, round(seconds * frame_rate))
    frame_duration = max(1, round(TIMESCALE / frame_rate))
    duration_units = frames * frame_duration
    payload_size = frames * BYTES_PER_FRAME

    # Deterministic filler, so the same request always hashes the same.
    filler = (seed * (payload_size // len(seed) + 1))[:payload_size]
    mdat = _box(b"mdat", filler)
    media_offset = len(_ftyp()) + 8

    stbl = _box(
        b"stbl",
        _stsd(width, height)
        + _stts(frames, frame_duration)
        + _stsc()
        + _stsz(frames, BYTES_PER_FRAME)
        + _stco(media_offset),
    )
    minf = _box(b"minf", _vmhd() + _dinf() + stbl)
    mdia = _box(b"mdia", _mdhd(duration_units) + _hdlr() + minf)
    trak = _box(b"trak", _tkhd(duration_units, width, height) + mdia)
    moov = _box(b"moov", _mvhd(duration_units) + trak)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_ftyp() + mdat + moov)
    return path


#: Dark, restrained palette. A clip's colour is derived from its prompt, so
#: scenes are distinguishable while staying deterministic.
_PALETTE = (
    (0x0A, 0x0F, 0x1A),
    (0x0D, 0x14, 0x22),
    (0x10, 0x18, 0x28),
    (0x0B, 0x16, 0x1E),
    (0x12, 0x1A, 0x2C),
    (0x08, 0x11, 0x1C),
)


def _colour_for(seed: bytes) -> str:
    """Pick a deterministic colour for a clip."""
    index = int(sha256_text(seed.decode("utf-8", errors="replace"))[:8], 16) % len(_PALETTE)
    red, green, blue = _PALETTE[index]
    return f"0x{red:02X}{green:02X}{blue:02X}"


def render_placeholder_clip(
    destination: Path,
    seconds: float,
    width: int,
    height: int,
    frame_rate: int = 24,
    seed: bytes = b"maingott",
    ffmpeg: FFmpeg | None = None,
) -> Path:
    """Write a placeholder clip, encoded when FFmpeg is available.

    An encoded clip decodes and can be composed; the hand-written container
    cannot, and is only good for exercising the asset stage.
    """
    runner = ffmpeg or FFmpeg()
    if not runner.is_available():
        return write_placeholder_mp4(destination, seconds, width, height, frame_rate, seed)

    destination.parent.mkdir(parents=True, exist_ok=True)
    runner.encode(
        inputs=[Path(f"color=c={_colour_for(seed)}:s={width}x{height}:r={frame_rate}")],
        output=destination,
        extra_input_args=[["-f", "lavfi"]],
        codec_args=[
            "-t",
            str(round(seconds, 3)),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-an",
        ],
        label="placeholder clip",
    )
    return destination
