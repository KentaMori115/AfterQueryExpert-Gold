"""Composition schemas.

Post-production is deterministic: given the same storyboard, assets and
settings it always builds the same timeline. These models are that timeline,
persisted as ``composition.json`` so a finished Reel can be explained frame by
frame — which clip, trimmed where, with which caption, over which audio.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import Field, model_validator

from maingott_reel.models.base import SCHEMA_VERSION, Language, SceneTransition, Schema
from maingott_reel.models.validation import ValidationReport

#: Bumped when composition behaviour changes in a way that alters output.
COMPOSITION_VERSION = "1.0"

#: How far the finished file may drift from the storyboard duration.
DURATION_TOLERANCE_SECONDS = 0.25


class TextRole(StrEnum):
    """What a piece of on-screen text is for."""

    TITLE = "title"
    SUBTITLE = "subtitle"
    CAPTION = "caption"
    BRAND = "brand"


class CropPolicy(StrEnum):
    """How footage that does not match the canvas is fitted to it."""

    CENTER = "center"
    """Scale to cover the canvas, then crop equally from both sides."""


class SafeArea(Schema):
    """Margins that on-screen text stays inside, as fractions of the frame.

    These are conservative project design values, not published platform
    requirements: phone interface elements sit over the top and bottom of a
    Reel, so text is kept away from both.
    """

    # Each margin is under half the frame, so a usable box always remains.
    top: float = Field(default=0.16, ge=0, lt=0.5)
    bottom: float = Field(default=0.22, ge=0, lt=0.5)
    left: float = Field(default=0.08, ge=0, lt=0.5)
    right: float = Field(default=0.08, ge=0, lt=0.5)

    def box(self, width: int, height: int) -> tuple[int, int, int, int]:
        """Return the usable ``(left, top, right, bottom)`` in pixels."""
        return (
            round(self.left * width),
            round(self.top * height),
            round(width - self.right * width),
            round(height - self.bottom * height),
        )


class TextStyle(Schema):
    """How one role of text is drawn."""

    role: TextRole
    font_size: int = Field(gt=0, le=400)
    color: str = "#FFFFFF"
    shadow_color: str = "#000000"
    shadow_offset: int = Field(default=3, ge=0, le=20)
    letter_spacing: float = Field(default=0.0, ge=0, le=20)
    line_spacing: float = Field(default=1.25, gt=0, le=3)
    uppercase: bool = False
    max_lines: int = Field(default=3, ge=1, le=6)


class CaptionCue(Schema):
    """One piece of on-screen text and when it is shown.

    The text is copied from the approved storyboard: composition never writes
    or rewrites viewer-facing wording.
    """

    id: str = Field(pattern=r"^C-\d{2,}$")
    scene_id: str = Field(pattern=r"^S-\d{2,}$")
    text: str = Field(min_length=1)
    role: TextRole = TextRole.CAPTION
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    image_path: Path | None = None

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> CaptionCue:
        if self.end_seconds <= self.start_seconds:
            raise ValueError(f"caption {self.id} ends before it starts")
        return self

    @property
    def duration_seconds(self) -> float:
        """How long the caption is on screen."""
        return round(self.end_seconds - self.start_seconds, 3)


class ScaleCrop(Schema):
    """The deterministic geometry applied to one clip."""

    source_width: int = Field(gt=0)
    source_height: int = Field(gt=0)
    scaled_width: int = Field(gt=0)
    scaled_height: int = Field(gt=0)
    crop_x: int = Field(ge=0)
    crop_y: int = Field(ge=0)
    output_width: int = Field(gt=0)
    output_height: int = Field(gt=0)
    policy: CropPolicy = CropPolicy.CENTER

    @property
    def is_upscale(self) -> bool:
        """Whether the source had to be enlarged to fill the canvas."""
        return self.scaled_width > self.source_width or self.scaled_height > self.source_height


class TimelineScene(Schema):
    """One scene's place on the finished timeline."""

    scene_id: str = Field(pattern=r"^S-\d{2,}$")
    beat_id: str = Field(pattern=r"^B-\d{2,}$")
    order: int = Field(ge=1)
    asset_id: str = Field(min_length=1)
    source_path: Path
    source_duration_seconds: float = Field(gt=0)
    trim_start_seconds: float = Field(default=0.0, ge=0)
    trim_duration_seconds: float = Field(gt=0)
    start_seconds: float = Field(ge=0)
    duration_seconds: float = Field(gt=0)
    transition: SceneTransition = SceneTransition.CUT
    transition_seconds: float = Field(default=0.0, ge=0, le=2)
    geometry: ScaleCrop
    normalized_path: Path | None = None

    @property
    def end_seconds(self) -> float:
        """Where the scene ends on the timeline."""
        return round(self.start_seconds + self.duration_seconds, 3)


class AudioPlan(Schema):
    """What the finished soundtrack is made of.

    When the narration came from the voice stage, the fields below record
    which track it was and what produced it, so the finished Reel can be
    traced back to the approved narration that was spoken.
    """

    voice_path: Path | None = None
    voice_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    voice_duration_seconds: float | None = Field(default=None, gt=0)
    voice_asset_id: str | None = None
    voice_provider: str | None = None
    voice_model: str | None = None
    voice_name: str | None = None
    voice_narration_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    voice_is_development: bool = Field(
        default=False, description="True when the narration is a placeholder, not a real voice"
    )
    music_path: Path | None = None
    music_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    voice_gain_db: float = 0.0
    music_gain_db: float = -18.0
    music_fade_seconds: float = Field(default=1.5, ge=0, le=5)
    sample_rate: int = Field(default=48000, gt=0)
    channels: int = Field(default=2, ge=1, le=2)
    silent: bool = False

    @property
    def has_music(self) -> bool:
        """Whether a music bed is part of the mix."""
        return self.music_path is not None


class LogoPlan(Schema):
    """The approved brand mark and where it sits."""

    path: Path
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    has_alpha: bool
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    position_x: int = Field(ge=0)
    position_y: int = Field(ge=0)
    render_width: int = Field(gt=0)


class FontInfo(Schema):
    """The typeface used for every caption."""

    family: str
    path: Path
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class CompositionSettings(Schema):
    """Deterministic post-production parameters."""

    width: int = Field(default=1080, gt=0)
    height: int = Field(default=1920, gt=0)
    fps: int = Field(default=30, gt=0, le=120)
    video_codec: str = "libx264"
    video_preset: str = "medium"
    video_crf: int = Field(default=19, ge=0, le=51)
    pixel_format: str = "yuv420p"
    audio_codec: str = "aac"
    audio_bitrate: str = "192k"
    crop_policy: CropPolicy = CropPolicy.CENTER
    transition_seconds: float = Field(default=0.4, ge=0, le=2)
    min_transition_seconds: float = Field(default=0.1, ge=0, le=1)
    caption_lead_in_seconds: float = Field(default=0.25, ge=0, le=2)
    caption_lead_out_seconds: float = Field(default=0.25, ge=0, le=2)
    safe_area: SafeArea = Field(default_factory=SafeArea)
    logo_width_ratio: float = Field(default=0.42, gt=0, le=1)

    @property
    def is_portrait(self) -> bool:
        """Whether the canvas is taller than it is wide."""
        return self.height > self.width


class Composition(Schema):
    """The persisted plan for one finished Reel."""

    schema_version: int = SCHEMA_VERSION
    version: str = COMPOSITION_VERSION
    created_at: datetime
    run_id: str = Field(min_length=1)
    language: Language = Language.RU
    target_duration_seconds: int = Field(ge=30, le=45)
    timeline_duration_seconds: float = Field(gt=0)
    settings: CompositionSettings
    scenes: list[TimelineScene] = Field(min_length=1)
    captions: list[CaptionCue] = Field(default_factory=list)
    audio: AudioPlan
    logo: LogoPlan | None = None
    font: FontInfo
    styles: list[TextStyle] = Field(default_factory=list)

    # --- provenance ---------------------------------------------------------
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    storyboard_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    narration_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    assets_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    composition_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    # --- results -------------------------------------------------------------
    output_path: Path | None = None
    output_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    output_size_bytes: int | None = Field(default=None, ge=0)
    validation: ValidationReport | None = None
    readiness: ValidationReport | None = Field(
        default=None,
        description="What still separates this Reel from a publishable one",
    )
    development: bool = Field(
        default=False, description="True when the Reel is missing production audio or branding"
    )

    @model_validator(mode="after")
    def _timeline_is_contiguous(self) -> Composition:
        cursor = 0.0
        for scene in self.scenes:
            if abs(scene.start_seconds - cursor) > 0.05:
                raise ValueError(
                    f"scene {scene.scene_id} starts at {scene.start_seconds}s, expected {cursor}s"
                )
            cursor = scene.end_seconds
        if abs(cursor - self.timeline_duration_seconds) > 0.05:
            raise ValueError(
                f"scenes cover {cursor}s but the timeline is {self.timeline_duration_seconds}s"
            )
        for caption in self.captions:
            if caption.end_seconds > self.timeline_duration_seconds + 0.05:
                raise ValueError(f"caption {caption.id} runs past the end of the timeline")
        return self

    @property
    def scene_count(self) -> int:
        """Number of scenes on the timeline."""
        return len(self.scenes)

    @property
    def passed(self) -> bool:
        """Whether the finished file passed validation."""
        return self.validation is not None and self.validation.passed
