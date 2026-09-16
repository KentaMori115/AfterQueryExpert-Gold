"""Reading and writing WAV files without a decoder."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from maingott_reel.audio.wav import WavError, parse_wav, tone_samples, write_wav


def _write(tmp_path: Path, seconds: float = 1.0, rate: int = 24000, channels: int = 1) -> Path:
    samples = tone_samples(seconds, rate) * channels
    return write_wav(tmp_path / "voice.wav", samples, sample_rate=rate, channels=channels)


def test_a_written_file_reads_back_with_the_same_shape(tmp_path: Path):
    path = _write(tmp_path, seconds=2.0)

    info = parse_wav(path)
    assert info.sample_rate == 24000
    assert info.channels == 1
    assert info.bits_per_sample == 16
    assert info.duration_seconds == pytest.approx(2.0, abs=0.01)
    assert info.data_bytes == info.frames * 2


def test_the_same_arguments_produce_the_same_bytes(tmp_path: Path):
    first = _write(tmp_path / "a", seconds=0.5)
    second = _write(tmp_path / "b", seconds=0.5)
    assert first.read_bytes() == second.read_bytes()


def test_different_durations_produce_different_files(tmp_path: Path):
    short = _write(tmp_path / "a", seconds=0.5)
    long = _write(tmp_path / "b", seconds=1.5)
    assert short.stat().st_size < long.stat().st_size


def test_stereo_is_understood(tmp_path: Path):
    path = _write(tmp_path, seconds=1.0, channels=2)
    info = parse_wav(path)
    assert info.channels == 2
    assert info.duration_seconds == pytest.approx(1.0, abs=0.01)


def test_a_file_that_is_not_a_riff_container_is_rejected(tmp_path: Path):
    path = tmp_path / "not.wav"
    path.write_bytes(b"\x00" * 200)
    with pytest.raises(WavError, match="RIFF"):
        parse_wav(path)


def test_a_truncated_file_reports_what_is_actually_there(tmp_path: Path):
    path = _write(tmp_path, seconds=2.0)
    full = parse_wav(path).duration_seconds
    raw = path.read_bytes()
    path.write_bytes(raw[: len(raw) // 2])

    assert parse_wav(path).duration_seconds < full


def test_a_missing_file_is_reported(tmp_path: Path):
    with pytest.raises(WavError):
        parse_wav(tmp_path / "absent.wav")


def test_a_non_pcm_format_is_refused(tmp_path: Path):
    path = _write(tmp_path)
    raw = bytearray(path.read_bytes())
    # The format tag sits immediately after the fmt chunk header.
    offset = raw.index(b"fmt ") + 8
    raw[offset : offset + 2] = struct.pack("<H", 3)  # IEEE float
    path.write_bytes(bytes(raw))

    with pytest.raises(WavError, match="linear PCM"):
        parse_wav(path)


def test_a_container_without_audio_data_is_refused(tmp_path: Path):
    path = tmp_path / "headerless.wav"
    fmt = struct.pack("<4sIHHIIHH", b"fmt ", 16, 1, 1, 24000, 48000, 2, 16)
    body = b"WAVE" + fmt + b"\x00" * 40
    path.write_bytes(struct.pack("<4sI", b"RIFF", len(body)) + body)

    with pytest.raises(WavError, match="no audio data"):
        parse_wav(path)


def test_empty_audio_is_never_written(tmp_path: Path):
    with pytest.raises(ValueError, match="no audio data"):
        write_wav(tmp_path / "empty.wav", b"", sample_rate=24000)


def test_an_unknown_bit_depth_is_refused(tmp_path: Path):
    with pytest.raises(ValueError, match="bit depth"):
        write_wav(tmp_path / "odd.wav", b"\x00\x01", sample_rate=24000, bits_per_sample=12)


def test_a_tone_needs_a_positive_duration():
    with pytest.raises(ValueError, match="positive duration"):
        tone_samples(0, 24000)


def test_a_tone_stays_quiet():
    samples = tone_samples(0.1, 24000, amplitude=0.06)
    peaks = [
        abs(struct.unpack("<h", samples[index : index + 2])[0])
        for index in range(0, len(samples), 2)
    ]
    assert max(peaks) <= int(32767 * 0.06) + 1
