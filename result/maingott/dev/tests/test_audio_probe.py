"""Inspecting generated audio, with and without FFmpeg."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.probe import ProbeError
from maingott_reel.audio.probe import (
    FFAudioProbe,
    WavProbe,
    default_audio_probe,
    parse_ffprobe_audio,
)
from maingott_reel.audio.wav import tone_samples, write_wav

FFPROBE_PAYLOAD = {
    "streams": [
        {
            "codec_type": "audio",
            "codec_name": "pcm_s16le",
            "sample_rate": "24000",
            "channels": 1,
            "duration": "35.104",
            "bit_rate": "384000",
        }
    ],
    "format": {"duration": "35.104", "bit_rate": "384000"},
}


def _wav(tmp_path: Path, seconds: float = 1.5) -> Path:
    return write_wav(
        tmp_path / "voice.wav", tone_samples(seconds, 24000), sample_rate=24000, channels=1
    )


# --- ffprobe output ---------------------------------------------------------


def test_ffprobe_output_is_parsed():
    info = parse_ffprobe_audio(FFPROBE_PAYLOAD)
    assert info.duration_seconds == 35.104
    assert info.sample_rate == 24000
    assert info.channels == 1
    assert info.codec == "pcm_s16le"
    assert info.audio_streams == 1
    assert info.video_streams == 0
    assert info.bit_rate == 384000
    assert info.tool == "ffprobe"


def test_a_file_without_an_audio_stream_is_rejected():
    payload = {"streams": [{"codec_type": "video", "duration": "4"}], "format": {}}
    with pytest.raises(ProbeError, match="no audio stream"):
        parse_ffprobe_audio(payload)


def test_a_stream_without_a_duration_is_rejected():
    payload = {"streams": [{"codec_type": "audio", "sample_rate": "24000", "channels": 1}]}
    with pytest.raises(ProbeError, match="no duration"):
        parse_ffprobe_audio(payload)


def test_a_stream_without_a_rate_is_rejected():
    payload = {
        "streams": [{"codec_type": "audio", "duration": "4", "sample_rate": "0", "channels": 0}]
    }
    with pytest.raises(ProbeError, match="rate or channel"):
        parse_ffprobe_audio(payload)


def test_extra_streams_are_counted():
    payload = {
        "streams": [
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "48000",
                "channels": 2,
                "duration": "40",
            },
            {"codec_type": "video", "duration": "40"},
            {"codec_type": "data"},
        ],
        "format": {},
    }
    info = parse_ffprobe_audio(payload)
    assert (info.audio_streams, info.video_streams, info.other_streams) == (1, 1, 1)


# --- the WAV fallback --------------------------------------------------------


def test_the_wav_probe_reads_a_real_file(tmp_path: Path):
    info = WavProbe().inspect_audio(_wav(tmp_path, 2.0))
    assert info.tool == "wav"
    assert info.duration_seconds == pytest.approx(2.0, abs=0.01)
    assert info.codec == "pcm_s16le"
    assert info.audio_streams == 1


def test_the_wav_probe_rejects_a_file_that_is_not_audio(tmp_path: Path):
    path = tmp_path / "broken.wav"
    path.write_bytes(b"not audio at all")
    with pytest.raises(ProbeError):
        WavProbe().inspect_audio(path)


# --- selection ----------------------------------------------------------------


def test_a_missing_ffprobe_falls_back_to_the_wav_reader():
    assert isinstance(default_audio_probe("definitely-not-installed"), WavProbe)


def test_ffprobe_is_used_when_it_is_installed(ffmpeg_paths: tuple[str, str]):
    probe = default_audio_probe(ffmpeg_paths[1])
    assert isinstance(probe, FFAudioProbe)


def test_ffprobe_reads_a_generated_track(tmp_path: Path, ffmpeg_paths: tuple[str, str]):
    info = FFAudioProbe(ffmpeg_paths[1]).inspect_audio(_wav(tmp_path, 1.0))
    assert info.tool == "ffprobe"
    assert info.duration_seconds == pytest.approx(1.0, abs=0.05)
    assert info.channels == 1
    assert info.sample_rate == 24000


def test_ffprobe_reports_a_missing_file():
    with pytest.raises(ProbeError, match="does not exist"):
        FFAudioProbe().inspect_audio(Path("nowhere.wav"))


def test_a_missing_binary_is_reported(tmp_path: Path):
    with pytest.raises(ProbeError, match="not installed"):
        FFAudioProbe("definitely-not-installed").inspect_audio(_wav(tmp_path))


def test_a_file_ffprobe_cannot_read_is_reported(tmp_path: Path, ffmpeg_paths: tuple[str, str]):
    path = tmp_path / "garbage.wav"
    path.write_bytes(b"\x00" * 4096)
    with pytest.raises(ProbeError):
        FFAudioProbe(ffmpeg_paths[1]).inspect_audio(path)
