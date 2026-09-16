"""Media inspection: ffprobe and the container fallback."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from maingott_reel.assets.probe import (
    ContainerProbe,
    FFProbe,
    MediaProbe,
    ProbeError,
    default_probe,
    parse_ffprobe,
)
from maingott_reel.providers.placeholder_video import write_placeholder_mp4

FFPROBE_OUTPUT = {
    "streams": [
        {
            "codec_type": "video",
            "codec_name": "h264",
            "width": 720,
            "height": 1280,
            "duration": "8.000000",
            "avg_frame_rate": "30000/1001",
        },
        {"codec_type": "audio", "codec_name": "aac", "duration": "8.000000"},
    ],
    "format": {"duration": "8.000000", "size": "1048576"},
}


# --- parsing ffprobe output ----------------------------------------------


def test_ffprobe_output_is_parsed():
    info = parse_ffprobe(FFPROBE_OUTPUT)
    assert info.duration_seconds == 8.0
    assert (info.width, info.height) == (720, 1280)
    assert info.codec == "h264"
    assert info.frame_rate == 29.97
    assert info.has_video_stream
    assert info.has_audio_stream
    assert info.tool == "ffprobe"


def test_output_without_a_video_stream_is_rejected():
    with pytest.raises(ProbeError, match="no video stream"):
        parse_ffprobe({"streams": [{"codec_type": "audio"}]})


def test_output_without_a_duration_is_rejected():
    payload = {"streams": [{"codec_type": "video", "width": 720, "height": 1280}], "format": {}}
    with pytest.raises(ProbeError, match="no duration"):
        parse_ffprobe(payload)


def test_duration_falls_back_to_the_container():
    payload = {
        "streams": [{"codec_type": "video", "width": 720, "height": 1280}],
        "format": {"duration": "12.0"},
    }
    assert parse_ffprobe(payload).duration_seconds == 12.0


@pytest.mark.parametrize(
    ("rate", "expected"), [("30/1", 30.0), ("0/0", None), ("", None), (None, None), ("bad", None)]
)
def test_frame_rates_are_parsed_defensively(rate: Any, expected: float | None):
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 720,
                "height": 1280,
                "duration": "4.0",
                "avg_frame_rate": rate,
            }
        ]
    }
    assert parse_ffprobe(payload).frame_rate == expected


# --- the ffprobe binary ---------------------------------------------------


def test_a_missing_binary_is_reported(tmp_path: Path):
    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)
    with pytest.raises(ProbeError, match="not installed"):
        FFProbe("definitely-not-installed-ffprobe").inspect(clip)


def test_a_missing_file_is_reported(tmp_path: Path):
    with pytest.raises(ProbeError, match="does not exist"):
        FFProbe().inspect(tmp_path / "absent.mp4")


def test_a_failing_binary_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)

    def _fail(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="broken file")

    monkeypatch.setattr(subprocess, "run", _fail)
    with pytest.raises(ProbeError, match="broken file"):
        FFProbe().inspect(clip)


def test_a_timeout_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)

    def _timeout(*args: object, **kwargs: object) -> None:
        raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=1)

    monkeypatch.setattr(subprocess, "run", _timeout)
    with pytest.raises(ProbeError, match="timed out"):
        FFProbe().inspect(clip)


def test_unreadable_output_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)

    def _garbage(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="not json", stderr="")

    monkeypatch.setattr(subprocess, "run", _garbage)
    with pytest.raises(ProbeError, match="unreadable"):
        FFProbe().inspect(clip)


def test_a_successful_run_is_parsed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import json

    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)

    def _ok(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps(FFPROBE_OUTPUT), stderr=""
        )

    monkeypatch.setattr(subprocess, "run", _ok)
    assert FFProbe().inspect(clip).codec == "h264"


# --- the container fallback ------------------------------------------------


def test_the_container_probe_reads_a_placeholder_clip(tmp_path: Path):
    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 8, 720, 1280)
    info = ContainerProbe().inspect(clip)
    assert info.duration_seconds == 8.0
    assert (info.width, info.height) == (720, 1280)
    assert info.has_video_stream
    assert info.tool == "container"


def test_the_container_probe_rejects_rubbish(tmp_path: Path):
    path = tmp_path / "rubbish.mp4"
    path.write_bytes(b"nonsense" * 100)
    with pytest.raises(ProbeError):
        ContainerProbe().inspect(path)


def test_probes_satisfy_the_protocol():
    assert isinstance(ContainerProbe(), MediaProbe)
    assert isinstance(FFProbe(), MediaProbe)


def test_the_default_probe_prefers_ffprobe_when_installed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "maingott_reel.assets.probe.shutil.which", lambda _binary: "/usr/bin/ffprobe"
    )
    assert default_probe().name == "ffprobe"


def test_the_default_probe_falls_back_without_ffprobe(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("maingott_reel.assets.probe.shutil.which", lambda _binary: None)
    assert default_probe().name == "container"


def test_a_container_without_media_data_is_rejected(tmp_path: Path):
    import struct

    from maingott_reel.assets.mp4 import parse_mp4

    clip = write_placeholder_mp4(tmp_path / "clip.mp4", 4, 720, 1280)
    data = clip.read_bytes()
    # Rename the mdat box so the container declares no media payload.
    stripped = data.replace(b"mdat", b"free", 1)
    empty = tmp_path / "nomedia.mp4"
    empty.write_bytes(stripped)

    assert parse_mp4(empty).has_media_data is False
    with pytest.raises(ProbeError, match="no media data"):
        ContainerProbe().inspect(empty)
    assert struct.calcsize(">I") == 4
