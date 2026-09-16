"""Application settings.

Configuration comes from environment variables and ``.env`` only, never from
hard-coded values inside pipeline code. Secrets are stored as ``SecretStr`` so
they cannot leak into logs or repr output by accident.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from maingott_reel.errors import ConfigurationError
from maingott_reel.models.base import AudioFormat, Language, VoiceFitStrategy
from maingott_reel.models.release import DEFAULT_RELEASE_VERSION, RELEASE_VERSION_PATTERN

LogFormat = Literal["json", "console"]


def _default_prompts_root() -> Path:
    """Locate the ``prompts/`` directory shipped with the project.

    Prompts belong to the application, not to the working directory, so the
    default is resolved next to the installed package and only falls back to a
    relative path when that layout is not present.
    """
    project_root = Path(__file__).resolve().parents[2]
    candidate = project_root / "prompts"
    return candidate if candidate.is_dir() else Path("prompts")


#: Current steerable speech model. ``gpt-4o-mini-tts`` is the only family that
#: accepts voice direction; see docs/architecture/OPENAI_INTEGRATION.md.
DEFAULT_TTS_MODEL = "gpt-4o-mini-tts"

#: Instagram Reel target. Portrait 9:16, see docs/creative/REEL_CREATIVE_BRIEF.md.
DEFAULT_VIDEO_WIDTH = 1080
DEFAULT_VIDEO_HEIGHT = 1920
DEFAULT_VIDEO_FPS = 30


class Settings(BaseSettings):
    """Runtime configuration for the Reel generator."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_assignment=True,
    )

    # --- Providers -----------------------------------------------------
    openai_api_key: SecretStr | None = None
    # Current official text model ids are gpt-5.6-sol / -terra / -luna.
    # Terra balances quality and cost, which suits structured planning.
    openai_text_model: str = "gpt-5.6-terra"
    openai_image_model: str = "gpt-image-2"
    openai_video_model: str = "sora-2"
    openai_tts_model: str = DEFAULT_TTS_MODEL
    openai_timeout_seconds: float = 120.0
    # Bounded on purpose: a retry storm is a spending storm.
    openai_max_retries: int = Field(default=5, ge=1, le=10)
    openai_reasoning_effort: str | None = None
    # Video generation is slow and paid: give it its own budget.
    video_request_timeout_seconds: float = Field(default=600.0, gt=0)
    video_poll_interval_seconds: float = Field(default=10.0, gt=0)
    video_generation_timeout_seconds: float = Field(default=1800.0, gt=0)
    video_max_attempts: int = Field(default=2, ge=1, le=5)
    openai_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    # Narration is a single short request, but a slow one.
    voice_request_timeout_seconds: float = Field(default=300.0, gt=0)

    # --- Filesystem ----------------------------------------------------
    input_root: Path = Path("input")
    output_root: Path = Path("output")
    source_document: Path = Path("input/source/MainGott_Technical_Specification_ru.docx")
    brand_dir: Path = Path("input/brand")
    brand_registry: Path | None = None
    voice_profile: Path | None = None
    pricing_file: Path | None = None
    prompts_root: Path = Field(default_factory=_default_prompts_root)
    caption_font: Path | None = None
    brand_logo: Path | None = None
    brand_music: Path | None = None

    # --- External binaries ---------------------------------------------
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    # --- Reel format ----------------------------------------------------
    default_reel_duration: int = 40
    min_reel_duration: int = 30
    max_reel_duration: int = 45
    video_width: int = DEFAULT_VIDEO_WIDTH
    video_height: int = DEFAULT_VIDEO_HEIGHT
    video_fps: int = DEFAULT_VIDEO_FPS

    # --- Creative planning ------------------------------------------------
    reel_language: Language = Language.RU
    planner_max_attempts: int = Field(default=3, ge=1, le=5)
    planner_beat_count: int = Field(default=8, ge=5, le=12)
    planner_max_facts: int = Field(default=90, ge=10, le=300)
    allow_target_facts: bool = False

    # --- Narration --------------------------------------------------------
    voice_provider: str = "openai"
    voice_name: str = "marin"
    voice_format: AudioFormat = AudioFormat.WAV
    voice_language: Language | None = None
    voice_instructions: str | None = None
    voice_speed: float | None = Field(default=None, ge=0.25, le=4.0)
    voice_fit_strategy: VoiceFitStrategy = VoiceFitStrategy.FAIL
    # Bounds for a fitting regeneration. Deliberately narrow: a large speed
    # change is a script problem, not a delivery problem.
    voice_min_speed: float = Field(default=0.9, ge=0.25, le=4.0)
    voice_max_speed: float = Field(default=1.2, ge=0.25, le=4.0)
    voice_max_attempts: int = Field(default=2, ge=1, le=5)

    # --- Cost control -------------------------------------------------------
    # No budget by default. Set one and generation stops rather than guessing.
    max_generation_cost: float | None = Field(default=None, ge=0)

    # --- Release ------------------------------------------------------------
    release_version: str = Field(default=DEFAULT_RELEASE_VERSION, pattern=RELEASE_VERSION_PATTERN)
    require_music: bool = False

    # --- Composition ------------------------------------------------------
    video_crf: int = Field(default=19, ge=0, le=51)
    video_preset: str = "medium"
    audio_bitrate: str = "192k"
    transition_seconds: float = Field(default=0.4, ge=0, le=2)
    music_gain_db: float = Field(default=-18.0, le=0)

    # --- Logging --------------------------------------------------------
    log_level: str = "INFO"
    log_format: LogFormat = "console"

    @field_validator(
        "caption_font",
        "brand_logo",
        "brand_music",
        "brand_registry",
        "voice_profile",
        "pricing_file",
        mode="before",
    )
    @classmethod
    def _blank_path_means_unset(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator(
        "openai_temperature",
        "voice_instructions",
        "voice_speed",
        "voice_language",
        "max_generation_cost",
        mode="before",
    )
    @classmethod
    def _blank_means_unset(cls, value: object) -> object:
        # Copying .env.example leaves optional keys present but empty.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("openai_tts_model", "voice_provider", "voice_name", mode="before")
    @classmethod
    def _blank_means_default(cls, value: object, info: ValidationInfo) -> object:
        # A required setting left empty in .env falls back to its default
        # rather than becoming an empty model or voice name.
        if isinstance(value, str) and not value.strip() and info.field_name:
            return cls.model_fields[info.field_name].default
        return value

    @field_validator("openai_reasoning_effort")
    @classmethod
    def _known_reasoning_effort(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        effort = value.strip().lower()
        # Values accepted by the current Responses API.
        allowed = {"none", "low", "medium", "high", "xhigh", "max"}
        if effort not in allowed:
            raise ValueError(f"openai_reasoning_effort must be one of {sorted(allowed)}")
        return effort

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        level = value.upper()
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if level not in allowed:
            raise ValueError(f"log_level must be one of {sorted(allowed)}")
        return level

    @model_validator(mode="after")
    def _check_duration_bounds(self) -> Settings:
        if self.min_reel_duration > self.max_reel_duration:
            raise ValueError("min_reel_duration must not exceed max_reel_duration")
        if not self.min_reel_duration <= self.default_reel_duration <= self.max_reel_duration:
            raise ValueError(
                "default_reel_duration must be between "
                f"{self.min_reel_duration} and {self.max_reel_duration}"
            )
        if self.video_width >= self.video_height:
            raise ValueError("video must be portrait: video_width must be less than video_height")
        if self.voice_min_speed > self.voice_max_speed:
            raise ValueError("voice_min_speed must not exceed voice_max_speed")
        return self

    # --- Derived helpers -------------------------------------------------
    @property
    def asset_cache_root(self) -> Path:
        """Directory holding generated assets shared across runs."""
        return self.output_root / "assets" / "cache"

    @property
    def runs_root(self) -> Path:
        """Directory holding every persisted run."""
        return self.output_root / "runs"

    @property
    def releases_root(self) -> Path:
        """Directory holding every immutable release package."""
        return self.output_root / "releases"

    @property
    def brand_registry_path(self) -> Path:
        """Where the approved brand asset registry is looked for."""
        return self.brand_registry or (self.brand_dir / "brand.json")

    @property
    def voice_profile_path(self) -> Path:
        """Where the approved narration voice profile is looked for."""
        return self.voice_profile or (self.brand_dir / "voice_profile.json")

    @property
    def pricing_path(self) -> Path:
        """Where the project's verified provider pricing is looked for."""
        return self.pricing_file or (self.input_root / "pricing.json")

    @property
    def aspect_ratio(self) -> str:
        """Aspect ratio label such as ``9:16``."""
        from math import gcd

        divisor = gcd(self.video_width, self.video_height)
        return f"{self.video_width // divisor}:{self.video_height // divisor}"

    def require_api_key(self) -> str:
        """Return the OpenAI key or fail loudly.

        Never log the return value.
        """
        if self.openai_api_key is None or not self.openai_api_key.get_secret_value().strip():
            raise ConfigurationError(
                "OPENAI_API_KEY is not set. Copy .env.example to .env and set the key."
            )
        return self.openai_api_key.get_secret_value()

    def resolve_duration(self, duration: int | None) -> int:
        """Validate a requested duration against the configured bounds."""
        value = self.default_reel_duration if duration is None else duration
        if not self.min_reel_duration <= value <= self.max_reel_duration:
            raise ConfigurationError(
                f"duration {value}s is outside the allowed range "
                f"{self.min_reel_duration}-{self.max_reel_duration}s"
            )
        return value

    def describe(self) -> dict[str, object]:
        """Return a log-safe view of the configuration (no secrets)."""
        return {
            "openai_api_key_set": self.openai_api_key is not None,
            "openai_text_model": self.openai_text_model,
            "openai_image_model": self.openai_image_model,
            "openai_video_model": self.openai_video_model,
            "openai_tts_model": self.openai_tts_model,
            "voice_provider": self.voice_provider,
            "voice_name": self.voice_name,
            "voice_format": self.voice_format.value,
            "voice_language": self.voice_language.value if self.voice_language else None,
            "voice_speed": self.voice_speed,
            "voice_fit_strategy": self.voice_fit_strategy.value,
            "voice_instructions_set": self.voice_instructions is not None,
            "openai_reasoning_effort": self.openai_reasoning_effort,
            "reel_language": self.reel_language.value,
            "allow_target_facts": self.allow_target_facts,
            "source_document": str(self.source_document),
            "output_root": str(self.output_root),
            "ffmpeg_bin": self.ffmpeg_bin,
            "ffprobe_bin": self.ffprobe_bin,
            "duration_default": self.default_reel_duration,
            "duration_bounds": [self.min_reel_duration, self.max_reel_duration],
            "asset_cache_root": str(self.asset_cache_root),
            "caption_font": str(self.caption_font) if self.caption_font else None,
            "brand_logo": str(self.brand_logo) if self.brand_logo else None,
            "max_generation_cost": self.max_generation_cost,
            "pricing_file": str(self.pricing_path),
            "brand_registry": str(self.brand_registry_path),
            "voice_profile": str(self.voice_profile_path),
            "release_version": self.release_version,
            "require_music": self.require_music,
            "resolution": f"{self.video_width}x{self.video_height}",
            "fps": self.video_fps,
            "aspect_ratio": self.aspect_ratio,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return process-wide settings (cached).

    Tests that patch the environment should call :func:`reset_settings_cache`.
    """
    return Settings()


def reset_settings_cache() -> None:
    """Clear the cached settings instance."""
    get_settings.cache_clear()
