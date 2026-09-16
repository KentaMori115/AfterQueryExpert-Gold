"""The FFmpeg wrapper."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from maingott_reel.utils.ffmpeg import FFmpeg, FFmpegError


def test_a_missing_binary_is_reported():
    with pytest.raises(FFmpegError, match="not installed"):
        FFmpeg("definitely-not-installed-ffmpeg").run(["-version"])


def test_availability_is_reported():
    assert not FFmpeg("definitely-not-installed-ffmpeg").is_available()


def test_the_version_is_read(ffmpeg_paths: tuple[str, str]):
    assert "ffmpeg version" in FFmpeg(ffmpeg_paths[0]).version()


def test_commands_are_argument_lists(
    ffmpeg_paths: tuple[str, str], monkeypatch: pytest.MonkeyPatch
):
    seen: dict[str, object] = {}
    real = subprocess.run

    def _capture(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        seen["command"] = command
        return real(command, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(subprocess, "run", _capture)
    FFmpeg(ffmpeg_paths[0]).run(["-version"])

    assert isinstance(seen["command"], list), "no shell string is ever built"
    assert seen["command"][0] == ffmpeg_paths[0]


def test_failures_carry_ffmpeg_diagnostics(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    with pytest.raises(FFmpegError) as error:
        FFmpeg(ffmpeg_paths[0]).run(["-i", str(tmp_path / "absent.mp4"), str(tmp_path / "out.mp4")])
    assert "FFmpeg failed" in str(error.value)
    assert error.value.command[0] == ffmpeg_paths[0]
    assert error.value.stderr


def test_a_timeout_is_reported(ffmpeg_paths: tuple[str, str], monkeypatch: pytest.MonkeyPatch):
    def _timeout(*args: object, **kwargs: object) -> None:
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

    monkeypatch.setattr(subprocess, "run", _timeout)
    with pytest.raises(FFmpegError, match="timed out"):
        FFmpeg(ffmpeg_paths[0]).run(["-version"], label="test")


def test_encoding_writes_the_output(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    destination = tmp_path / "nested" / "clip.mp4"
    FFmpeg(ffmpeg_paths[0]).encode(
        inputs=[Path("color=c=black:s=64x64:r=10")],
        output=destination,
        extra_input_args=[["-f", "lavfi"]],
        codec_args=["-t", "0.5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        label="test clip",
    )
    assert destination.is_file()
    assert destination.stat().st_size > 0


def test_a_failed_encode_leaves_no_partial_file(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    destination = tmp_path / "clip.mp4"
    with pytest.raises(FFmpegError):
        FFmpeg(ffmpeg_paths[0]).encode(
            inputs=[tmp_path / "absent.mp4"], output=destination, label="doomed"
        )
    assert not destination.exists()
    assert not list(tmp_path.glob(".*.part*"))
