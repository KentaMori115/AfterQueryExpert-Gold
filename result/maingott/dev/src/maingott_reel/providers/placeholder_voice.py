"""Writing placeholder narration.

The offline voice provider needs to hand the pipeline a file that behaves like
generated narration: real audio, of a plausible length for the words it stands
for, that FFmpeg can mix. This module writes one — a quiet, slowly pulsing
tone, deterministic in its bytes, and unmistakably not a voice.

Its length is derived from the narration and the language's expected speaking
rate, so the speech-rate and timeline checks are exercised for real rather
than bypassed.

These are placeholders standing in for narration, not narration. Never ship
one in a published Reel.
"""

from __future__ import annotations

from pathlib import Path

from maingott_reel.audio.wav import tone_samples, write_wav
from maingott_reel.creative.claims import SPEECH_RATE_CPS
from maingott_reel.models.base import Language
from maingott_reel.utils.hashing import sha256_text

#: What the offline provider writes: 24 kHz mono, matching the rate the real
#: speech API returns for PCM, so the mix behaves the same either way.
OFFLINE_SAMPLE_RATE = 24000

#: Shortest placeholder worth writing.
MIN_SECONDS = 0.5

#: Pitches used for the placeholder tone, picked deterministically from the
#: narration so two different scripts do not sound identical.
_PITCHES = (146.8, 155.6, 164.8, 174.6, 185.0, 196.0)


def estimated_seconds(text: str, language: Language, speed: float | None = None) -> float:
    """How long the narration would take to speak, at the expected rate.

    Raises:
        ValueError: there is nothing to speak.
    """
    if not text.strip():
        raise ValueError("a placeholder track needs narration to stand in for")
    rate = SPEECH_RATE_CPS[language] * (speed or 1.0)
    return round(max(MIN_SECONDS, len(text) / rate), 3)


def _pitch_for(text: str) -> float:
    """Pick a deterministic pitch for a script."""
    return _PITCHES[int(sha256_text(text)[:8], 16) % len(_PITCHES)]


def render_placeholder_voice(
    destination: Path,
    text: str,
    language: Language,
    speed: float | None = None,
    sample_rate: int = OFFLINE_SAMPLE_RATE,
) -> tuple[Path, float]:
    """Write a placeholder narration track and return it with its duration.

    The file is deterministic: identical arguments produce identical bytes.

    Raises:
        ValueError: there is nothing to speak.
    """
    seconds = estimated_seconds(text, language, speed)
    samples = tone_samples(seconds, sample_rate, frequency=_pitch_for(text))
    write_wav(destination, samples, sample_rate=sample_rate, channels=1)
    return destination, seconds
