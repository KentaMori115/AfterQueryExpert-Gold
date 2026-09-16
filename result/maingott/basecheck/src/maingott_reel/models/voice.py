"""Narration schemas.

The voice stage speaks the narration the planner approved and nothing else, so
a voice record has to answer, on its own: which approved narration it was
generated from, which provider, model, voice and settings produced it, what
the audio actually turned out to be, and whether it fits the storyboard's
timeline.

``narration_sha256`` is the binding: it is the hash of the approved narration
in ``script.json``, and composition refuses any track whose hash does not match
the storyboard it is being mixed into.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import Field, model_validator

from maingott_reel.models.base import (
    SCHEMA_VERSION,
    AssetSource,
    AssetStatus,
    AssetType,
    AudioFormat,
    Language,
    Schema,
)
from maingott_reel.models.provenance import GenerationProvenance
from maingott_reel.models.validation import ValidationReport

#: Bumped when voice identity or the generation contract changes.
VOICE_VERSION = "1.0"

#: How much longer than the timeline the narration may run before it would be
#: cut off by the mix. Composition pads a shorter track with silence.
TIMELINE_TOLERANCE_SECONDS = 0.25


class SpeechMetrics(Schema):
    """How fast the generated narration actually speaks.

    Measured from the audio, not taken from provider metadata: the duration
    comes from the file itself.
    """

    characters: int = Field(gt=0)
    words: int = Field(gt=0)
    duration_seconds: float = Field(gt=0)
    timeline_seconds: float = Field(gt=0)

    @property
    def characters_per_second(self) -> float:
        """Spoken characters per second."""
        return round(self.characters / self.duration_seconds, 2)

    @property
    def words_per_minute(self) -> float:
        """Spoken words per minute."""
        return round(self.words / self.duration_seconds * 60, 1)

    @property
    def headroom_seconds(self) -> float:
        """Timeline time left over after the narration ends."""
        return round(self.timeline_seconds - self.duration_seconds, 3)

    @property
    def fits_timeline(self) -> bool:
        """Whether the narration can be heard in full inside the timeline."""
        return self.duration_seconds <= self.timeline_seconds + TIMELINE_TOLERANCE_SECONDS


class VoiceAsset(Schema):
    """The narration track generated for one run."""

    schema_version: int = SCHEMA_VERSION
    version: str = VOICE_VERSION
    id: str = Field(min_length=1)
    asset_type: AssetType = AssetType.VOICE
    status: AssetStatus = AssetStatus.PENDING
    source: AssetSource = AssetSource.GENERATED
    created_at: datetime

    # --- what was asked for -------------------------------------------------
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    voice: str = Field(min_length=1)
    language: Language = Language.RU
    audio_format: AudioFormat = AudioFormat.WAV
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    instructions: str | None = None
    instructions_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    cache_key: str = Field(pattern=r"^[0-9a-f]{64}$")

    # --- what it must say ---------------------------------------------------
    narration_sha256: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="Hash of the approved narration this track speaks",
    )
    narration_characters: int = Field(gt=0)
    storyboard_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_duration_seconds: float = Field(gt=0)

    # --- what came back -----------------------------------------------------
    path: Path | None = None
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    size_bytes: int | None = Field(default=None, ge=0)
    duration_seconds: float | None = Field(default=None, gt=0)
    sample_rate: int | None = Field(default=None, gt=0)
    channels: int | None = Field(default=None, ge=1, le=8)
    codec: str | None = None
    metrics: SpeechMetrics | None = None

    # --- bookkeeping ---------------------------------------------------------
    attempts: int = Field(default=0, ge=0)
    cache_hit: bool = False
    development: bool = Field(
        default=False, description="True when the track is a placeholder, not a real voice"
    )
    transformations: list[str] = Field(
        default_factory=list,
        description="Every deliberate change to the audio, e.g. a regeneration at a new speed",
    )
    generation_metadata: dict[str, Any] = Field(default_factory=dict)
    validation: ValidationReport | None = None
    provenance: GenerationProvenance
    error: str | None = None

    @model_validator(mode="after")
    def _ready_tracks_have_a_verified_file(self) -> VoiceAsset:
        if self.status in (AssetStatus.READY, AssetStatus.CACHED):
            if self.path is None:
                raise ValueError(f"voice {self.id} is {self.status} but has no path")
            if self.sha256 is None:
                raise ValueError(f"voice {self.id} is {self.status} but has no sha256")
            if self.duration_seconds is None:
                raise ValueError(f"voice {self.id} is {self.status} but has no duration")
            if self.validation is not None and not self.validation.passed:
                raise ValueError(f"voice {self.id} is {self.status} but failed validation")
        if self.status is AssetStatus.FAILED and not self.error:
            raise ValueError(f"voice {self.id} failed but carries no error message")
        return self

    @property
    def is_usable(self) -> bool:
        """Whether composition may mix this track in."""
        return self.status in (AssetStatus.READY, AssetStatus.CACHED)

    @property
    def passed(self) -> bool:
        """Whether the track passed deterministic voice validation."""
        return self.validation is not None and self.validation.passed


class AuditionSample(Schema):
    """One candidate voice reading the same approved sample."""

    voice: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    language: Language = Language.RU
    audio_format: AudioFormat = AudioFormat.WAV
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    instructions_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    path: Path | None = None
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    size_bytes: int | None = Field(default=None, ge=0)
    duration_seconds: float | None = Field(default=None, gt=0)
    sample_rate: int | None = Field(default=None, gt=0)
    channels: int | None = Field(default=None, ge=1, le=8)
    codec: str | None = None
    created_at: datetime
    development: bool = False
    error: str | None = None

    @property
    def usable(self) -> bool:
        """Whether this candidate produced audio a human can listen to."""
        return self.error is None and self.path is not None and self.duration_seconds is not None

    def describe(self) -> str:
        """One line identifying exactly what produced this sample."""
        return f"{self.provider}:{self.model} voice '{self.voice}' ({self.language.value})"


class VoiceAudition(Schema):
    """Candidate voices reading one short piece of the approved narration.

    An audition exists so a person can listen and decide. Nothing here selects
    or approves a voice: the decision is recorded by hand in
    ``input/brand/voice_profile.json``.
    """

    schema_version: int = SCHEMA_VERSION
    version: str = VOICE_VERSION
    created_at: datetime
    run_id: str = Field(min_length=1)
    sample_text: str = Field(min_length=1, description="Verbatim extract of approved narration")
    sample_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    narration_sha256: str = Field(
        pattern=r"^[0-9a-f]{64}$", description="The full approved narration this came from"
    )
    samples: list[AuditionSample] = Field(default_factory=list)

    @property
    def usable(self) -> list[AuditionSample]:
        """Candidates that produced audio."""
        return [sample for sample in self.samples if sample.usable]

    @property
    def failed(self) -> list[AuditionSample]:
        """Candidates that did not."""
        return [sample for sample in self.samples if not sample.usable]

    def summary(self) -> str:
        """One line describing the audition."""
        return (
            f"{len(self.usable)}/{len(self.samples)} candidate voices recorded "
            f"{len(self.sample_text)} characters of approved narration"
        )
