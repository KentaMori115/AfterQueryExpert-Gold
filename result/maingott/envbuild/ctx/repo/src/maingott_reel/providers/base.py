"""Provider interfaces.

Business logic depends on these protocols only. Concrete adapters (OpenAI and
test fakes) live beside this module; nothing here may import a vendor SDK, so
importing this module never touches the network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel

from maingott_reel.models.base import AudioFormat, Language

ModelT = TypeVar("ModelT", bound=BaseModel)


@dataclass(frozen=True)
class Usage:
    """Provider usage metadata recorded in the run manifest."""

    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    requests: int = 1
    estimated_cost_usd: float | None = None


@dataclass(frozen=True)
class TextResult:
    """A validated structured response."""

    value: Any
    usage: Usage


@dataclass(frozen=True)
class VideoCapabilities:
    """What a video provider can actually be asked for.

    Providers do not accept arbitrary durations or sizes. The asset stage
    validates every scene against these before spending anything, instead of
    discovering the limits from a paid error response.
    """

    supported_seconds: tuple[int, ...]
    supported_sizes: tuple[tuple[int, int], ...]
    max_prompt_chars: int
    supports_audio: bool = False

    @property
    def max_seconds(self) -> int:
        """Longest clip the provider will generate."""
        return max(self.supported_seconds)

    def seconds_for(self, requested: float) -> int | None:
        """Return the shortest supported duration that covers ``requested``."""
        candidates = [value for value in sorted(self.supported_seconds) if value >= requested]
        return candidates[0] if candidates else None

    def portrait_sizes(self) -> tuple[tuple[int, int], ...]:
        """Supported sizes that are taller than they are wide."""
        return tuple((w, h) for w, h in self.supported_sizes if h > w)

    def best_portrait_size(self, target_width: int, target_height: int) -> tuple[int, int] | None:
        """Return the portrait size closest to the target aspect ratio.

        Ties are broken towards the larger frame, so composition upscales as
        little as possible.
        """
        portrait = self.portrait_sizes()
        if not portrait:
            return None
        target_ratio = target_width / target_height
        return min(
            portrait,
            key=lambda size: (round(abs(size[0] / size[1] - target_ratio), 4), -size[1]),
        )

    def supports(self, seconds: int, size: tuple[int, int]) -> bool:
        """Whether an exact request is generatable."""
        return seconds in self.supported_seconds and size in self.supported_sizes


@dataclass(frozen=True)
class VoiceCapabilities:
    """What a voice provider can actually be asked for.

    Checked before anything is paid for, so an unsupported voice, format or
    language fails immediately and visibly instead of arriving as an API error
    — or, worse, as narration in the wrong language.
    """

    supported_voices: tuple[str, ...]
    supported_formats: tuple[AudioFormat, ...]
    supported_languages: tuple[Language, ...]
    max_input_chars: int
    supports_instructions: bool = False
    supports_speed: bool = False
    speed_range: tuple[float, float] = (1.0, 1.0)

    def supports_voice(self, voice: str) -> bool:
        """Whether this voice can be requested."""
        return voice in self.supported_voices

    def supports_speed_value(self, speed: float | None) -> bool:
        """Whether this speaking speed can be requested."""
        if speed is None:
            return True
        if not self.supports_speed:
            return False
        low, high = self.speed_range
        return low <= speed <= high

    def clamp_speed(self, speed: float) -> float:
        """Return ``speed`` brought inside the supported range."""
        low, high = self.speed_range
        return round(min(max(speed, low), high), 3)

    def describe(self) -> str:
        """A one-line summary for error messages."""
        voices = ", ".join(self.supported_voices)
        formats = ", ".join(item.value for item in self.supported_formats)
        return f"voices: {voices}; formats: {formats}; up to {self.max_input_chars} characters"


@dataclass(frozen=True)
class MediaResult:
    """A generated media file on disk."""

    path: Path
    usage: Usage
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class TextProvider(Protocol):
    """Structured text/planning generation."""

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        ...

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        ...

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[ModelT],
        temperature: float | None = None,
    ) -> TextResult:
        """Return an instance of ``schema`` produced by the model."""
        ...


@runtime_checkable
class ImageProvider(Protocol):
    """Still image generation."""

    def generate_image(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        destination: Path,
    ) -> MediaResult:
        """Render ``prompt`` into an image file at ``destination``."""
        ...


@runtime_checkable
class VideoProvider(Protocol):
    """Video clip generation."""

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        ...

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        ...

    @property
    def capabilities(self) -> VideoCapabilities:
        """What this provider will accept."""
        ...

    def generate_video(
        self,
        *,
        prompt: str,
        seconds: int,
        width: int,
        height: int,
        destination: Path,
    ) -> MediaResult:
        """Render ``prompt`` into a video file at ``destination``.

        ``seconds`` and the size must be values the provider supports.
        """
        ...


@runtime_checkable
class VoiceProvider(Protocol):
    """Narration synthesis.

    The provider speaks the text it is given, exactly. Nothing in this
    interface lets a caller — or an implementation — reword it.
    """

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        ...

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        ...

    @property
    def capabilities(self) -> VoiceCapabilities:
        """What this provider will accept."""
        ...

    def synthesize(
        self,
        *,
        text: str,
        voice: str,
        language: Language,
        audio_format: AudioFormat,
        destination: Path,
        instructions: str | None = None,
        speed: float | None = None,
    ) -> MediaResult:
        """Speak ``text`` into an audio file at ``destination``.

        ``text`` is the approved narration and must be synthesised verbatim.
        """
        ...
