"""Providers that need no network.

Two implementations live here:

:class:`ScriptedTextProvider`
    replays prepared results (or raises prepared errors) and records the
    prompts it was given. Tests use it to drive the planner through valid and
    invalid model behaviour without an API key.

:class:`OfflinePlanProvider`
    builds a schema-valid plan from the facts it is given, so the pipeline can
    be exercised end to end with ``plan --dry-run``. It composes narration from
    verbatim fact statements, which makes it a wiring check rather than a
    creative one.

:class:`OfflineStoryboardProvider`
    does the same for shots: one house-style prompt per beat, so
    ``storyboard --dry-run`` exercises the stage without a model.

:class:`OfflineVideoProvider`
    writes placeholder MP4 containers instead of calling a video model, so the
    asset stage, the cache and the validators can be exercised for free. The
    clips are structurally valid but are not real footage — see
    :mod:`maingott_reel.providers.placeholder_video`.

:class:`OfflineVoiceProvider`
    writes a real, quiet placeholder WAV instead of calling a speech model, of
    a plausible length for the words it stands for, so the voice stage, the
    cache, the validators and the mix can be exercised for free. It is not a
    voice — see :mod:`maingott_reel.providers.placeholder_voice`.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from maingott_reel.creative.draft import (
    CreativePlanDraft,
    DraftBeat,
    DraftBrief,
    DraftClaim,
    DraftShot,
    StoryboardDraft,
)
from maingott_reel.errors import ProviderError, TransientProviderError
from maingott_reel.models import (
    AudioFormat,
    BeatKind,
    ClaimStatus,
    Fact,
    FactRegistry,
    Language,
    ScriptPlan,
)
from maingott_reel.providers.base import (
    MediaResult,
    TextResult,
    Usage,
    VideoCapabilities,
    VoiceCapabilities,
)
from maingott_reel.providers.placeholder_video import render_placeholder_clip
from maingott_reel.providers.placeholder_voice import (
    OFFLINE_SAMPLE_RATE,
    render_placeholder_voice,
)
from maingott_reel.utils.ffmpeg import FFmpeg

FAKE_PROVIDER_NAME = "fake"
OFFLINE_MODEL = "offline-planner"


class ScriptedTextProvider:
    """A text provider that returns prepared results in order."""

    def __init__(
        self,
        results: Sequence[BaseModel | Exception],
        name: str = FAKE_PROVIDER_NAME,
        model: str = "scripted",
    ) -> None:
        """Store the scripted results.

        Args:
            results: returned (or raised) one per call, in order.
            name: provider name reported in artifacts.
            model: model id reported in artifacts.
        """
        self._results = list(results)
        self._name = name
        self._model = model
        self.calls: list[dict[str, object]] = []

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return self._name

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        return self._model

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None = None,
    ) -> TextResult:
        """Return the next scripted result.

        Raises:
            ProviderError: no result was scripted for this call, or the scripted
                entry is an exception.
        """
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "schema": schema.__name__,
                "temperature": temperature,
            }
        )
        if not self._results:
            raise ProviderError("ScriptedTextProvider ran out of scripted results")
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return TextResult(
            value=result, usage=Usage(model=self._model, input_tokens=0, output_tokens=0)
        )


def _pick(facts: Iterable[Fact], count: int) -> list[Fact]:
    """Take the first ``count`` usable facts."""
    usable = [
        fact
        for fact in facts
        if fact.claim_status is ClaimStatus.SUPPORTED and 30 <= len(fact.statement) <= 200
    ]
    return usable[:count]


class OfflinePlanProvider:
    """Builds a valid draft plan from the registry, without a model."""

    def __init__(self, registry: FactRegistry, beat_count: int = 8) -> None:
        """Store the facts this provider may cite."""
        self._registry = registry
        self._beat_count = beat_count

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return FAKE_PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        return OFFLINE_MODEL

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None = None,
    ) -> TextResult:
        """Return a deterministic draft plan.

        Raises:
            ProviderError: the registry holds too few usable facts.
        """
        if schema is not CreativePlanDraft:
            raise ProviderError(f"OfflinePlanProvider cannot produce {schema.__name__}")

        factual_beats = max(self._beat_count - 2, 3)
        facts = _pick(self._registry.facts, factual_beats)
        if len(facts) < 3:
            raise ProviderError("The fact registry holds too few usable facts for a plan")

        beats = [
            DraftBeat(
                order=1,
                kind="framing",
                purpose="Показать разрозненность каналов",
                narration="Клиенты приходят из разных каналов.",
                on_screen_text="Разные каналы",
                visual_direction="Тёмная сцена, расходящиеся потоки данных",
                estimated_seconds=4.0,
                claims=[],
            )
        ]
        for position, fact in enumerate(facts, start=2):
            beats.append(
                DraftBeat(
                    order=position,
                    kind="factual",
                    purpose="Показать возможность платформы",
                    narration=fact.statement,
                    on_screen_text="MainGott",
                    visual_direction="Тёмный премиальный интерфейс, спокойное движение камеры",
                    estimated_seconds=round(max(2.0, min(9.0, len(fact.statement) / 12)), 2),
                    claims=[
                        DraftClaim(claim=fact.statement, kind="factual", source_fact_ids=[fact.id])
                    ],
                )
            )
        brand_fact = facts[0]
        beats.append(
            DraftBeat(
                order=len(beats) + 1,
                kind="brand",
                purpose="Логотип и позиционирование",
                narration="MainGott. Sales and Operations OS.",
                on_screen_text="MAINGOTT",
                visual_direction="Логотип на тёмном фоне",
                estimated_seconds=4.0,
                claims=[
                    DraftClaim(
                        claim="MainGott — единая платформа продаж и управления.",
                        kind="factual",
                        source_fact_ids=[brand_fact.id],
                    )
                ],
            )
        )

        draft = CreativePlanDraft(
            brief=DraftBrief(
                objective="Представить MainGott как единую систему продаж и операций.",
                audience="Владельцы и руководители бизнеса",
                tone="Спокойный, уверенный, профессиональный",
                visual_direction="Тёмная премиальная среда, чистая анимация данных",
                core_message="MainGott — Sales & Operations OS.",
                supporting_messages=["Один связанный путь клиента."],
                cta="MAINGOTT",
                restrictions=[],
                source_fact_ids=[fact.id for fact in facts],
            ),
            beats=beats,
        )
        return TextResult(
            value=draft, usage=Usage(model=OFFLINE_MODEL, input_tokens=0, output_tokens=0)
        )


#: House-style shot prompts, one per beat role. Deliberately generic: this is
#: a wiring check, not a creative treatment.
_SHOT_PROMPTS: dict[BeatKind, str] = {
    BeatKind.FRAMING: (
        "Slow cinematic push through a dark studio space where separate streams of soft blue "
        "light drift apart without ever meeting, shallow depth of field, volumetric haze, "
        "calm and restrained mood, generous empty space across the upper third of the frame."
    ),
    BeatKind.FACTUAL: (
        "Slow orbital camera move around a dark premium environment where flowing lines of "
        "light converge into a single calm core, polished glass and brushed metal surfaces, "
        "abstract panels reduced to plain glowing shapes, cinematic key light, professional "
        "and confident mood, clean negative space across the lower third of the frame."
    ),
    BeatKind.BRAND: (
        "Slow settle onto a dark, almost empty frame as the streams of light resolve into one "
        "steady horizontal line, soft falloff into shadow, matte surfaces, cinematic "
        "stillness, wide clean centre of frame left deliberately empty."
    ),
}

_TRANSITIONS: dict[BeatKind, Literal["cut", "fade", "dissolve"]] = {
    BeatKind.FRAMING: "cut",
    BeatKind.FACTUAL: "dissolve",
    BeatKind.BRAND: "fade",
}


class OfflineStoryboardProvider:
    """Builds a valid shot draft from a plan, without a model."""

    def __init__(self, plan: ScriptPlan) -> None:
        """Store the plan whose beats will be given shots."""
        self._plan = plan

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return FAKE_PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        return OFFLINE_MODEL

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None = None,
    ) -> TextResult:
        """Return a deterministic shot for every beat of the plan.

        Raises:
            ProviderError: a schema other than the storyboard draft was asked for.
        """
        if schema is not StoryboardDraft:
            raise ProviderError(f"OfflineStoryboardProvider cannot produce {schema.__name__}")

        draft = StoryboardDraft(
            shots=[
                DraftShot(
                    beat_id=beat.id,
                    visual_description=f"Тёмная премиальная сцена для бита {beat.id}.",
                    video_prompt=_SHOT_PROMPTS[beat.kind],
                    transition=_TRANSITIONS[beat.kind],
                )
                for beat in self._plan.beats
            ]
        )
        return TextResult(
            value=draft, usage=Usage(model=OFFLINE_MODEL, input_tokens=0, output_tokens=0)
        )


#: The offline provider mirrors the real one's limits, so a storyboard that
#: works offline works against the paid provider too.
OFFLINE_VIDEO_CAPABILITIES = VideoCapabilities(
    supported_seconds=(4, 8, 12),
    supported_sizes=((720, 1280), (1280, 720), (1024, 1792), (1792, 1024)),
    max_prompt_chars=2000,
    supports_audio=False,
)

OFFLINE_VIDEO_MODEL = "offline-video"


class OfflineVideoProvider:
    """Writes placeholder clips instead of generating video.

    Failures can be scripted per scene so tests can drive retry, resume and
    partial-failure behaviour deterministically.
    """

    def __init__(
        self,
        failures: dict[str, Exception] | None = None,
        capabilities: VideoCapabilities | None = None,
        corrupt: set[str] | None = None,
        model: str = OFFLINE_VIDEO_MODEL,
        ffmpeg: FFmpeg | None = None,
    ) -> None:
        """Configure the provider.

        Args:
            failures: exception to raise per prompt fragment or scene marker.
                Each entry fires once, then the next call succeeds.
            capabilities: override the advertised limits.
            corrupt: markers whose generated file should be truncated, to
                exercise download verification.
            model: model id reported in artifacts.
            ffmpeg: used to encode a decodable clip when available.
        """
        self._failures = dict(failures or {})
        self._capabilities = capabilities or OFFLINE_VIDEO_CAPABILITIES
        self._corrupt = set(corrupt or ())
        self._model = model
        self._ffmpeg = ffmpeg
        self.calls: list[dict[str, object]] = []

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return FAKE_PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        return self._model

    @property
    def capabilities(self) -> VideoCapabilities:
        """What this provider will accept."""
        return self._capabilities

    def generate_video(
        self,
        *,
        prompt: str,
        seconds: int,
        width: int,
        height: int,
        destination: Path,
    ) -> MediaResult:
        """Write a deterministic placeholder clip.

        Raises:
            ProviderError: the request is outside the advertised capabilities,
                or a failure was scripted for this call.
        """
        self.calls.append(
            {"prompt": prompt, "seconds": seconds, "size": (width, height), "path": destination}
        )
        if not self._capabilities.supports(seconds, (width, height)):
            raise ProviderError(f"offline provider cannot generate {seconds}s at {width}x{height}")
        for marker, error in list(self._failures.items()):
            if marker in prompt:
                del self._failures[marker]
                raise error

        render_placeholder_clip(
            destination,
            seconds,
            width,
            height,
            seed=prompt.encode("utf-8")[:16],
            ffmpeg=self._ffmpeg,
        )
        if any(marker in prompt for marker in self._corrupt):
            destination.write_bytes(destination.read_bytes()[:200])

        return MediaResult(
            path=destination,
            usage=Usage(model=self._model, requests=1),
            duration_seconds=float(seconds),
            width=width,
            height=height,
            metadata={"offline": True},
        )


#: The offline provider mirrors the real one's limits where they matter, so a
#: narration that works offline works against the paid provider too. It offers
#: one voice, named for what it is.
OFFLINE_VOICE_NAME = "offline"
OFFLINE_VOICE_MODEL = "offline-voice"

OFFLINE_VOICE_CAPABILITIES = VoiceCapabilities(
    supported_voices=(OFFLINE_VOICE_NAME,),
    supported_formats=(AudioFormat.WAV,),
    supported_languages=(Language.RU, Language.EN),
    max_input_chars=4096,
    supports_instructions=True,
    supports_speed=True,
    speed_range=(0.25, 4.0),
)


class OfflineVoiceProvider:
    """Writes placeholder narration instead of synthesising speech.

    The audio is real and decodable, and its length follows the words it
    stands for, so timing, validation and mixing behave as they will with a
    real voice. Failures can be scripted so tests can drive retry and failure
    behaviour deterministically.
    """

    def __init__(
        self,
        failures: Sequence[Exception] | None = None,
        capabilities: VoiceCapabilities | None = None,
        corrupt: bool = False,
        model: str = OFFLINE_VOICE_MODEL,
        sample_rate: int = OFFLINE_SAMPLE_RATE,
    ) -> None:
        """Configure the provider.

        Args:
            failures: raised one per call, in order, before any success.
            capabilities: override the advertised limits.
            corrupt: truncate the written file, to exercise validation.
            model: model id reported in artifacts.
            sample_rate: rate of the written audio.
        """
        self._failures = list(failures or ())
        self._capabilities = capabilities or OFFLINE_VOICE_CAPABILITIES
        self._corrupt = corrupt
        self._model = model
        self._sample_rate = sample_rate
        self.calls: list[dict[str, object]] = []

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return FAKE_PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id recorded in artifacts."""
        return self._model

    @property
    def capabilities(self) -> VoiceCapabilities:
        """What this provider will accept."""
        return self._capabilities

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
        """Write a deterministic placeholder narration track.

        Raises:
            ProviderError: the request is outside the advertised capabilities,
                or a failure was scripted for this call.
        """
        self.calls.append(
            {
                "characters": len(text),
                "voice": voice,
                "language": language.value,
                "format": audio_format.value,
                "speed": speed,
                "instructions": instructions,
                "path": destination,
            }
        )
        if not text.strip():
            raise ProviderError("there is no narration to speak")
        if not self._capabilities.supports_voice(voice):
            raise ProviderError(f"offline provider does not offer the voice '{voice}'")
        if audio_format not in self._capabilities.supported_formats:
            raise ProviderError(f"offline provider cannot return {audio_format.value}")
        if language not in self._capabilities.supported_languages:
            raise ProviderError(f"offline provider cannot speak {language.value}")
        if self._failures:
            raise self._failures.pop(0)

        _, seconds = render_placeholder_voice(
            destination, text, language, speed=speed, sample_rate=self._sample_rate
        )
        if self._corrupt:
            destination.write_bytes(destination.read_bytes()[:200])

        return MediaResult(
            path=destination,
            usage=Usage(model=self._model, requests=1),
            duration_seconds=seconds,
            metadata={"offline": True, "development": True, "voice": voice},
        )


def transient_failure(message: str = "temporary provider outage") -> TransientProviderError:
    """A scripted failure that the manager should retry."""
    return TransientProviderError(message)


def permanent_failure(message: str = "unsupported request") -> ProviderError:
    """A scripted failure that the manager should not retry."""
    return ProviderError(message)
