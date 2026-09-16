"""Minimal MP4 container reader.

``ffprobe`` is the primary way this project inspects generated media, but it is
an external dependency that is not always installed. This module reads the
container structure directly — enough to answer whether a file is a real MP4
with a video track, and what its duration and dimensions are.

It is a structural reader, not a decoder: it proves the container is
well-formed and self-consistent, not that the pictures decode.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

#: Boxes that contain other boxes rather than payload.
_CONTAINER_BOXES = frozenset({b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts"})

_HEADER = 8


class Mp4Error(ValueError):
    """The file is not a readable MP4 container."""


@dataclass(frozen=True)
class Mp4Info:
    """What the container says about itself."""

    brand: str
    duration_seconds: float
    width: int
    height: int
    codec: str
    frame_count: int
    has_video_track: bool
    has_media_data: bool

    @property
    def frame_rate(self) -> float | None:
        """Frames per second, when the container carries enough to say."""
        if self.frame_count <= 0 or self.duration_seconds <= 0:
            return None
        return round(self.frame_count / self.duration_seconds, 3)


def _iter_boxes(data: bytes, start: int, end: int) -> list[tuple[bytes, int, int]]:
    """Return ``(type, payload_start, payload_end)`` for the boxes in a range."""
    boxes: list[tuple[bytes, int, int]] = []
    offset = start
    while offset + _HEADER <= end:
        (size,) = struct.unpack_from(">I", data, offset)
        box_type = data[offset + 4 : offset + 8]
        if size == 0:
            size = end - offset
        elif size == 1:
            if offset + 16 > end:
                raise Mp4Error("truncated 64-bit box header")
            (size,) = struct.unpack_from(">Q", data, offset + 8)
            boxes.append((box_type, offset + 16, min(offset + size, end)))
            offset += size
            continue
        if size < _HEADER or offset + size > end:
            raise Mp4Error(f"box '{box_type.decode(errors='replace')}' has an invalid size")
        boxes.append((box_type, offset + _HEADER, offset + size))
        offset += size
    return boxes


def _find(data: bytes, path: tuple[bytes, ...], start: int, end: int) -> tuple[int, int] | None:
    """Return the payload range of a nested box path, if present."""
    current = (start, end)
    for name in path:
        found = None
        for box_type, box_start, box_end in _iter_boxes(data, *current):
            if box_type == name:
                found = (box_start, box_end)
                break
        if found is None:
            return None
        current = found
    return current


def parse_mp4(path: Path) -> Mp4Info:
    """Read the structure of an MP4 file.

    Raises:
        Mp4Error: the file is missing, empty, or not a usable MP4.
    """
    if not path.is_file():
        raise Mp4Error(f"file does not exist: {path}")
    data = path.read_bytes()
    if not data:
        raise Mp4Error("file is empty")

    boxes = _iter_boxes(data, 0, len(data))
    types = {box_type for box_type, _, _ in boxes}
    if b"ftyp" not in types:
        raise Mp4Error("no ftyp box: this is not an MP4 container")
    if b"moov" not in types:
        raise Mp4Error("no moov box: the file carries no movie metadata")

    ftyp_start, _ftyp_end = next((s, e) for t, s, e in boxes if t == b"ftyp")
    brand = data[ftyp_start : ftyp_start + 4].decode("ascii", errors="replace")
    moov_start, moov_end = next((s, e) for t, s, e in boxes if t == b"moov")

    mvhd = _find(data, (b"mvhd",), moov_start, moov_end)
    if mvhd is None:
        raise Mp4Error("no mvhd box: the movie has no header")
    duration_seconds = _movie_duration(data, *mvhd)

    trak = _find(data, (b"trak",), moov_start, moov_end)
    width = height = 0
    codec = ""
    frame_count = 0
    if trak is not None:
        width, height = _track_dimensions(data, *trak)
        codec = _track_codec(data, *trak)
        frame_count = _sample_count(data, *trak)

    return Mp4Info(
        brand=brand,
        duration_seconds=duration_seconds,
        width=width,
        height=height,
        codec=codec,
        frame_count=frame_count,
        has_video_track=trak is not None and width > 0 and height > 0,
        has_media_data=b"mdat" in types,
    )


def _movie_duration(data: bytes, start: int, end: int) -> float:
    """Read the duration from an mvhd box."""
    version = data[start]
    if version == 1:
        timescale, duration = struct.unpack_from(">IQ", data, start + 20)
    else:
        timescale, duration = struct.unpack_from(">II", data, start + 12)
    if timescale == 0:
        raise Mp4Error("mvhd declares a zero timescale")
    return round(float(duration) / float(timescale), 3)


def _track_dimensions(data: bytes, start: int, end: int) -> tuple[int, int]:
    """Read the visual dimensions from a track header."""
    tkhd = _find(data, (b"tkhd",), start, end)
    if tkhd is None:
        return 0, 0
    box_start = tkhd[0]
    version = data[box_start]
    # Track header layout: fixed fields, then the 36-byte matrix, then the
    # 16.16 fixed point width and height.
    offset = box_start + (88 if version == 1 else 76)
    if offset + 8 > tkhd[1]:
        return 0, 0
    width_fixed, height_fixed = struct.unpack_from(">II", data, offset)
    return width_fixed >> 16, height_fixed >> 16


def _track_codec(data: bytes, start: int, end: int) -> str:
    """Read the sample entry's four character code."""
    stsd = _find(data, (b"mdia", b"minf", b"stbl", b"stsd"), start, end)
    if stsd is None:
        return ""
    entries = _iter_boxes(data, stsd[0] + 8, stsd[1])
    if not entries:
        return ""
    return entries[0][0].decode("ascii", errors="replace")


def _sample_count(data: bytes, start: int, end: int) -> int:
    """Count the samples declared by the sample size table."""
    stsz = _find(data, (b"mdia", b"minf", b"stbl", b"stsz"), start, end)
    if stsz is None:
        return 0
    (count,) = struct.unpack_from(">I", data, stsz[0] + 8)
    return int(count)
