"""The MP4 container reader and the placeholder writer."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from maingott_reel.assets.mp4 import Mp4Error, parse_mp4
from maingott_reel.providers.placeholder_video import write_placeholder_mp4


def _clip(tmp_path: Path, seconds: float = 8, width: int = 720, height: int = 1280) -> Path:
    return write_placeholder_mp4(tmp_path / "clip.mp4", seconds, width, height)


def test_a_written_clip_reads_back(tmp_path: Path):
    info = parse_mp4(_clip(tmp_path))
    assert info.brand == "isom"
    assert info.duration_seconds == 8.0
    assert (info.width, info.height) == (720, 1280)
    assert info.codec == "avc1"
    assert info.has_video_track
    assert info.has_media_data


@pytest.mark.parametrize("seconds", [4, 8, 12])
def test_durations_are_exact(tmp_path: Path, seconds: int):
    assert parse_mp4(_clip(tmp_path, seconds)).duration_seconds == float(seconds)


def test_frame_rate_is_derived_from_the_sample_table(tmp_path: Path):
    info = parse_mp4(_clip(tmp_path))
    assert info.frame_count == 8 * 24
    assert info.frame_rate == 24.0


def test_writing_is_deterministic(tmp_path: Path):
    first = write_placeholder_mp4(tmp_path / "a.mp4", 4, 720, 1280).read_bytes()
    second = write_placeholder_mp4(tmp_path / "b.mp4", 4, 720, 1280).read_bytes()
    assert first == second


def test_a_different_prompt_seed_changes_the_bytes(tmp_path: Path):
    first = write_placeholder_mp4(tmp_path / "a.mp4", 4, 720, 1280, seed=b"one").read_bytes()
    second = write_placeholder_mp4(tmp_path / "b.mp4", 4, 720, 1280, seed=b"two").read_bytes()
    assert first != second


def test_dimensions_are_carried_through(tmp_path: Path):
    info = parse_mp4(_clip(tmp_path, 4, 1024, 1792))
    assert (info.width, info.height) == (1024, 1792)


@pytest.mark.parametrize(("seconds", "width"), [(0, 720), (-1, 720), (4, 0)])
def test_impossible_clips_are_refused(tmp_path: Path, seconds: float, width: int):
    with pytest.raises(ValueError):
        write_placeholder_mp4(tmp_path / "bad.mp4", seconds, width, 1280)


def test_a_missing_file_is_reported(tmp_path: Path):
    with pytest.raises(Mp4Error, match="does not exist"):
        parse_mp4(tmp_path / "absent.mp4")


def test_an_empty_file_is_reported(tmp_path: Path):
    path = tmp_path / "empty.mp4"
    path.write_bytes(b"")
    with pytest.raises(Mp4Error, match="empty"):
        parse_mp4(path)


def test_a_file_that_is_not_an_mp4_is_reported(tmp_path: Path):
    path = tmp_path / "text.mp4"
    path.write_bytes(b"just some bytes that are not a container at all")
    with pytest.raises(Mp4Error):
        parse_mp4(path)


def test_a_container_without_a_movie_header_is_reported(tmp_path: Path):
    path = tmp_path / "noheader.mp4"
    ftyp = struct.pack(">I", 16) + b"ftyp" + b"isom" + struct.pack(">I", 512)
    path.write_bytes(ftyp)
    with pytest.raises(Mp4Error, match="no moov"):
        parse_mp4(path)


def test_a_truncated_clip_is_reported(tmp_path: Path):
    clip = _clip(tmp_path)
    clip.write_bytes(clip.read_bytes()[: len(clip.read_bytes()) // 2])
    with pytest.raises(Mp4Error):
        parse_mp4(clip)


def test_a_box_with_an_impossible_size_is_reported(tmp_path: Path):
    path = tmp_path / "bogus.mp4"
    path.write_bytes(struct.pack(">I", 4096) + b"ftyp" + b"isom")
    with pytest.raises(Mp4Error, match="invalid size"):
        parse_mp4(path)


def test_a_movie_without_a_track_reports_no_video(tmp_path: Path):
    clip = _clip(tmp_path)
    data = clip.read_bytes().replace(b"trak", b"skip", 1)
    path = tmp_path / "notrack.mp4"
    path.write_bytes(data)

    info = parse_mp4(path)
    assert info.has_video_track is False
    assert info.width == 0
    assert info.frame_rate is None


def test_a_track_without_a_sample_table_reports_no_codec(tmp_path: Path):
    clip = _clip(tmp_path)
    data = clip.read_bytes().replace(b"stsd", b"skip", 1).replace(b"stsz", b"skip", 1)
    path = tmp_path / "nostbl.mp4"
    path.write_bytes(data)

    info = parse_mp4(path)
    assert info.codec == ""
    assert info.frame_count == 0


def test_a_zero_timescale_is_rejected(tmp_path: Path):
    clip = _clip(tmp_path)
    data = bytearray(clip.read_bytes())
    index = data.index(b"mvhd") + 4 + 12  # version/flags, times, then timescale
    data[index : index + 4] = struct.pack(">I", 0)
    path = tmp_path / "zero.mp4"
    path.write_bytes(bytes(data))

    with pytest.raises(Mp4Error, match="zero timescale"):
        parse_mp4(path)


def test_a_box_that_runs_to_the_end_of_the_file_is_read(tmp_path: Path):
    payload = b"\x00" * 32
    path = tmp_path / "openbox.mp4"
    ftyp = struct.pack(">I", 16) + b"ftyp" + b"isom" + struct.pack(">I", 512)
    open_box = struct.pack(">I", 0) + b"free" + payload
    path.write_bytes(ftyp + open_box)

    with pytest.raises(Mp4Error, match="no moov"):
        parse_mp4(path)


def test_a_64_bit_box_header_is_read(tmp_path: Path):
    path = tmp_path / "large.mp4"
    ftyp = struct.pack(">I", 16) + b"ftyp" + b"isom" + struct.pack(">I", 512)
    payload = b"\x00" * 16
    large = struct.pack(">I", 1) + b"free" + struct.pack(">Q", 16 + len(payload)) + payload
    path.write_bytes(ftyp + large)

    with pytest.raises(Mp4Error, match="no moov"):
        parse_mp4(path)


def test_a_truncated_64_bit_header_is_reported(tmp_path: Path):
    path = tmp_path / "bad64.mp4"
    path.write_bytes(struct.pack(">I", 1) + b"free" + b"\x00\x00")
    with pytest.raises(Mp4Error, match="truncated"):
        parse_mp4(path)


def test_a_container_whose_first_box_is_not_ftyp_is_reported(tmp_path: Path):
    path = tmp_path / "noftyp.mp4"
    path.write_bytes(struct.pack(">I", 16) + b"free" + b"\x00" * 8)
    with pytest.raises(Mp4Error, match="not an MP4"):
        parse_mp4(path)


def test_a_movie_without_a_header_is_reported(tmp_path: Path):
    clip = _clip(tmp_path)
    data = clip.read_bytes().replace(b"mvhd", b"skip", 1)
    path = tmp_path / "nomvhd.mp4"
    path.write_bytes(data)
    with pytest.raises(Mp4Error, match="no mvhd"):
        parse_mp4(path)


def test_a_track_without_a_header_reports_no_dimensions(tmp_path: Path):
    clip = _clip(tmp_path)
    data = clip.read_bytes().replace(b"tkhd", b"skip", 1)
    path = tmp_path / "notkhd.mp4"
    path.write_bytes(data)
    assert parse_mp4(path).width == 0


def test_a_sample_description_without_entries_reports_no_codec(tmp_path: Path):
    clip = _clip(tmp_path)
    data = clip.read_bytes().replace(b"avc1", b"skip", 1)
    path = tmp_path / "noavc1.mp4"
    path.write_bytes(data)
    assert parse_mp4(path).codec == "skip"
