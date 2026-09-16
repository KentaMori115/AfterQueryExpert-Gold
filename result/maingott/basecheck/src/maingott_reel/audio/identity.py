"""Voice identity and cache keys.

The same two-hash split the asset stage uses:

``cache_key``
    everything that defines the *content* of the audio — provider, model,
    voice, language, format, speaking speed, voice direction and the words
    themselves. Two runs asking for the same narration in the same voice share
    one generated file, and any change to the request produces a different key.

``voice_id``
    the cache key plus where the track belongs — the run's source document and
    the storyboard it was generated for. It stays stable across re-runs of the
    same storyboard, so resuming a run finds the same id.

``narration_sha256`` is separate from both: it is the hash of the *exact*
approved narration in ``script.json``, unnormalised, and it is what binds the
audio to the script. Only the cache key sees the whitespace-normalised form,
so re-indenting the narration does not pay for the same audio twice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from maingott_reel.assets.identity import normalize_prompt
from maingott_reel.models import AudioFormat, Language
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import dumps

#: Bumped when the meaning of a voice request changes and old cache entries
#: must not be reused even though the visible fields look identical.
REQUEST_VERSION = 1


@dataclass(frozen=True)
class VoiceRequest:
    """The narration one run needs, resolved against a provider."""

    narration: str
    provider: str
    model: str
    voice: str
    language: Language
    audio_format: AudioFormat
    storyboard_sha256: str
    source_sha256: str
    target_duration_seconds: float
    speed: float | None = None
    instructions: str | None = None
    prompt_version: str = "1"
    settings: dict[str, Any] = field(default_factory=dict)

    @property
    def spoken_text(self) -> str:
        """The words sent to the provider: the approved narration, verbatim."""
        return self.narration

    @property
    def narration_sha256(self) -> str:
        """Hash of the approved narration, exactly as the plan holds it."""
        return sha256_text(self.narration)

    @property
    def instructions_sha256(self) -> str | None:
        """Hash of the voice direction, when there is one."""
        return sha256_text(self.instructions) if self.instructions else None

    @property
    def cache_key(self) -> str:
        """Content-defining hash, shared across runs."""
        payload = {
            "version": REQUEST_VERSION,
            "asset_type": "voice",
            "provider": self.provider,
            "model": self.model,
            "voice": self.voice,
            "language": self.language.value,
            "format": self.audio_format.value,
            "speed": self.speed,
            "instructions": normalize_prompt(self.instructions) if self.instructions else None,
            "narration": normalize_prompt(self.narration),
            "settings": self.settings,
        }
        return sha256_text(dumps(payload).decode("utf-8"))

    @property
    def voice_id(self) -> str:
        """Stable identity of this track inside this run."""
        payload = {
            "cache_key": self.cache_key,
            "storyboard_sha256": self.storyboard_sha256,
            "source_sha256": self.source_sha256,
        }
        digest = sha256_text(dumps(payload).decode("utf-8"))
        return f"voice-{digest[:12]}"

    @property
    def characters(self) -> int:
        """How many characters have to be spoken."""
        return len(self.narration)

    @property
    def words(self) -> int:
        """How many words have to be spoken."""
        return len(self.narration.split())

    def with_speed(self, speed: float | None) -> VoiceRequest:
        """Return the same request at a different speaking speed."""
        return VoiceRequest(**{**self.__dict__, "speed": speed})

    def describe(self) -> dict[str, Any]:
        """A log- and manifest-safe summary of the request.

        The narration itself is never logged: only its hash and its size.
        """
        return {
            "voice_id": self.voice_id,
            "cache_key": self.cache_key,
            "provider": self.provider,
            "model": self.model,
            "voice": self.voice,
            "language": self.language.value,
            "format": self.audio_format.value,
            "speed": self.speed,
            "narration_sha256": self.narration_sha256,
            "characters": self.characters,
            "words": self.words,
            "target_duration_seconds": self.target_duration_seconds,
        }
