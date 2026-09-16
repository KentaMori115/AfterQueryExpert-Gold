"""Speaking the approved narration scene by scene.

The whole-script take answers one question: can the narration be heard inside
the Reel. It cannot answer the narrower one a viewer actually notices, which
is whether a line is still being spoken when its scene has already cut away.
Cutting the script at the storyboard's own scene boundaries answers that,
because every take is then measured against the seconds its own scene runs.

Three rules do the work here and none of them is about audio quality:

* a take belongs to one scene and is measured from the audio that came back,
  never from a character count, which is the same rule the whole-script take
  has always followed;
* when anything overruns, the Reel is re-spoken at **one** speaking speed, the
  slowest that makes every take fit. A Reel that speeds up for one scene and
  slows down for the next sounds broken even when every scene technically
  fits;
* the same words at the same speed are paid for once, however many scenes say
  them.

What comes out is still a single narration track laid on the storyboard's
timeline, so composition, the audit and the release gates keep reading exactly
what they read before.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from maingott_reel.audio.identity import VoiceRequest
from maingott_reel.audio.probe import AudioInfo
from maingott_reel.audio.validation import fit_speed
from maingott_reel.audio.wav import place_samples, read_pcm, write_wav
from maingott_reel.errors import ConfigurationError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    TIMELINE_TOLERANCE_SECONDS,
    AudioFormat,
    NarrationTake,
    Storyboard,
)
from maingott_reel.providers.base import VoiceCapabilities
from maingott_reel.utils.hashing import sha256_text

logger = get_logger("audio.takes")

#: Formats a take can be laid onto a timeline without a decoder.
ASSEMBLABLE_FORMATS = (AudioFormat.WAV, AudioFormat.PCM)


class Attempt(Protocol):
    """What one synthesis attempt reports back.

    Structural on purpose: the generation stage owns the attempt type, and
    this module only ever asks it how it went.
    """

    path: Path | None
    info: AudioInfo | None
    error: str | None

    @property
    def audio_is_sound(self) -> bool:
        """Whether the file is real, correct audio, timing aside."""
        ...


#: Speaks one request into one file. The stage supplies it; the caller decides
#: whether the cache may answer, which is what makes a repeated take free.
Speak = Callable[[VoiceRequest, Path, bool], Attempt]


@dataclass(frozen=True)
class TakeSlot:
    """One scene's words, and the seconds they have to be said in."""

    scene_id: str
    start_seconds: float
    scene_seconds: float
    request: VoiceRequest

    @property
    def text(self) -> str:
        """The words this take speaks."""
        return self.request.narration


@dataclass(frozen=True)
class SpokenTake:
    """A slot that has been through the provider or the cache."""

    slot: TakeSlot
    attempt: Attempt
    cache_hit: bool = False

    @property
    def duration_seconds(self) -> float:
        """Measured length of the audio, from the file itself."""
        info = self.attempt.info
        return info.duration_seconds if info is not None else 0.0

    @property
    def fits(self) -> bool:
        """Whether the words can be heard inside their own scene."""
        return self.duration_seconds <= self.slot.scene_seconds + TIMELINE_TOLERANCE_SECONDS

    def record(self) -> NarrationTake:
        """The persisted description of this take."""
        return NarrationTake(
            scene_id=self.slot.scene_id,
            text_sha256=sha256_text(self.slot.text),
            cache_key=self.slot.request.cache_key,
            characters=self.slot.request.characters,
            start_seconds=self.slot.start_seconds,
            duration_seconds=self.duration_seconds,
            scene_seconds=self.slot.scene_seconds,
            speed=self.slot.request.speed,
            cache_hit=self.cache_hit,
        )


@dataclass
class TakeRound:
    """Every take of one pass over the storyboard."""

    takes: list[SpokenTake] = field(default_factory=list)
    error: str | None = None

    @property
    def sound(self) -> bool:
        """Whether every take came back as real, correct audio."""
        return self.error is None and all(take.attempt.audio_is_sound for take in self.takes)

    @property
    def overrunning(self) -> list[SpokenTake]:
        """Takes that are still being spoken when their scene has cut away."""
        return [take for take in self.takes if not take.fits]

    @property
    def spoken_seconds(self) -> float:
        """How much of the finished track is words rather than silence."""
        return round(sum(take.duration_seconds for take in self.takes), 3)


def slots(storyboard: Storyboard, request: VoiceRequest) -> list[TakeSlot]:
    """Cut the approved narration at the storyboard's scene boundaries.

    A scene with nothing to say is not a take: it is silence on the timeline,
    and silence is never generated and never paid for.
    """
    cut: list[TakeSlot] = []
    for scene in storyboard.scenes:
        spoken = scene.voiceover.strip()
        if not spoken:
            logger.info("scene has no narration", extra={"scene": scene.id})
            continue
        cut.append(
            TakeSlot(
                scene_id=scene.id,
                start_seconds=scene.start_seconds,
                scene_seconds=scene.duration_seconds,
                request=request.for_scene(scene.id, scene.voiceover, scene.duration_seconds),
            )
        )
    return cut


def required_speed(take: SpokenTake) -> float:
    """How fast this take would have to be said to fit its own scene.

    Derived from the audio that came back, so a provider that speaks slower
    than the language's expected rate is answered with the speed it actually
    needs rather than the one a character count predicts.
    """
    needed = fit_speed(take.duration_seconds, take.slot.scene_seconds)
    return round(needed * (take.slot.request.speed or 1.0), 3)


def shared_speed(round_: TakeRound) -> float:
    """The one speed that makes every take fit.

    The slowest of what each take needs, so nothing is rushed further than it
    has to be and nothing is left overrunning.
    """
    return round(max((required_speed(take) for take in round_.takes), default=1.0), 3)


def speed_is_available(
    speed: float, capabilities: VoiceCapabilities, low: float, high: float
) -> bool:
    """Whether the provider and the configuration both allow this speed."""
    if not capabilities.supports_speed:
        return False
    provider_low, provider_high = capabilities.speed_range
    return max(low, provider_low) <= speed <= min(high, provider_high)


def speak_round(
    cut: Sequence[TakeSlot],
    speak: Speak,
    destination: Callable[[str], Path],
    generated: set[str],
    use_cache: bool = True,
) -> TakeRound:
    """Speak every take once, in scene order.

    ``generated`` carries the cache keys this run has already produced. A take
    whose words and speed have been spoken already is served from the cache
    even when the caller asked for everything to be generated afresh: forcing
    regeneration means ignoring what earlier runs left behind, not paying
    twice inside one run for one piece of narration.
    """
    result = TakeRound()
    for slot in cut:
        repeat = slot.request.cache_key in generated
        attempt = speak(slot.request, destination(slot.scene_id), use_cache or repeat)
        if attempt.error is not None or not attempt.audio_is_sound:
            result.error = attempt.error or f"{slot.scene_id}: the take did not pass validation"
            result.takes.append(SpokenTake(slot=slot, attempt=attempt, cache_hit=repeat))
            return result
        result.takes.append(SpokenTake(slot=slot, attempt=attempt, cache_hit=repeat))
        generated.add(slot.request.cache_key)
    return result


def at_speed(cut: Sequence[TakeSlot], speed: float) -> list[TakeSlot]:
    """The same cut, to be spoken at one shared speaking speed."""
    return [
        TakeSlot(
            scene_id=slot.scene_id,
            start_seconds=slot.start_seconds,
            scene_seconds=slot.scene_seconds,
            request=slot.request.with_speed(speed),
        )
        for slot in cut
    ]


def overrun_summary(round_: TakeRound) -> str:
    """Name every scene whose narration is still being spoken after the cut."""
    return "; ".join(
        f"{take.slot.scene_id} takes {take.duration_seconds}s of a "
        f"{take.slot.scene_seconds}s scene"
        for take in round_.overrunning
    )


def assemble(round_: TakeRound, total_seconds: float, destination: Path) -> Path:
    """Lay the takes onto the storyboard's timeline and write one track.

    Every take starts at its own scene's start instant, so a take that came
    back a little short leaves silence behind it instead of dragging the rest
    of the Reel forward. The finished file is exactly the storyboard's length.

    Raises:
        ConfigurationError: a take is not linear PCM and cannot be laid down
            without a decoder.
    """
    blocks: list[tuple[float, bytes]] = []
    rate: int | None = None
    channels: int | None = None
    depth: int | None = None
    for take in round_.takes:
        path = take.attempt.path
        if path is None:
            raise ConfigurationError(f"{take.slot.scene_id} produced no audio to lay down")
        info, samples = read_pcm(path)
        if rate is None:
            rate, channels, depth = info.sample_rate, info.channels, info.bits_per_sample
        elif (info.sample_rate, info.channels, info.bits_per_sample) != (rate, channels, depth):
            raise ConfigurationError(
                f"{take.slot.scene_id} came back as {info.sample_rate} Hz / {info.channels} ch "
                f"and the Reel is being built at {rate} Hz / {channels} ch. Every take has to "
                "be the same kind of audio."
            )
        blocks.append((take.slot.start_seconds, samples))

    if rate is None or channels is None or depth is None:
        raise ConfigurationError("there are no takes to lay onto the timeline")

    return write_wav(
        destination,
        place_samples(blocks, total_seconds, rate, channels, depth),
        sample_rate=rate,
        channels=channels,
        bits_per_sample=depth,
    )


def check_assemblable(audio_format: AudioFormat) -> None:
    """Refuse a format that cannot be laid onto a timeline here.

    Raises:
        ConfigurationError: the narration format is not linear PCM.
    """
    if audio_format not in ASSEMBLABLE_FORMATS:
        raise ConfigurationError(
            f"Narration is requested as {audio_format.value}, and takes are laid onto the "
            "timeline as linear PCM. Set VOICE_FORMAT to wav, or speak the Reel as one take."
        )


__all__ = [
    "ASSEMBLABLE_FORMATS",
    "SpokenTake",
    "TakeRound",
    "TakeSlot",
    "assemble",
    "at_speed",
    "check_assemblable",
    "overrun_summary",
    "required_speed",
    "shared_speed",
    "slots",
    "speak_round",
    "speed_is_available",
]
