"""Shared model base class and enumerations."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict

#: Bumped whenever a persisted schema changes incompatibly.
SCHEMA_VERSION = 1


class Schema(BaseModel):
    """Base class for every persisted schema.

    ``extra="forbid"`` makes malformed model output fail loudly instead of
    silently dropping fields.
    """

    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )


class BlockType(StrEnum):
    """Kind of block extracted from the source document."""

    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE_ROW = "table_row"


class ClaimStatus(StrEnum):
    """How well a statement is backed by the source specification."""

    SUPPORTED = "supported"
    """Directly stated in the specification."""

    TARGET = "target"
    """A design target; must never be presented as an achieved result."""

    UNSUPPORTED = "unsupported"
    """Not backed by the source. Must not reach the final advertisement."""


class ClaimKind(StrEnum):
    """What kind of statement a claim makes."""

    FACTUAL = "factual"
    """An assertion about MainGott. Requires supporting fact ids."""

    TARGET = "target"
    """A design target. Wording must preserve its target nature."""


class BeatKind(StrEnum):
    """The role a script beat plays in the advertisement."""

    FRAMING = "framing"
    """Problem framing. Must not assert anything about MainGott."""

    FACTUAL = "factual"
    """States something about the product. Requires claims."""

    BRAND = "brand"
    """Positioning or brand close. Requires claims."""


class FactCategory(StrEnum):
    """Coarse grouping used by the creative planner."""

    POSITIONING = "positioning"
    CAPABILITY = "capability"
    ARCHITECTURE = "architecture"
    CHANNEL = "channel"
    INTEGRATION = "integration"
    AI = "ai"
    ANALYTICS = "analytics"
    CUSTOMER_JOURNEY = "customer_journey"
    OPERATIONS = "operations"
    OTHER = "other"


class AssetType(StrEnum):
    """Kind of generated media."""

    IMAGE = "image"
    VIDEO = "video"
    VOICE = "voice"
    MUSIC = "music"


class AssetStatus(StrEnum):
    """Lifecycle of a generated asset."""

    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    CACHED = "cached"
    FAILED = "failed"


class DurationStrategy(StrEnum):
    """How a scene's duration was mapped onto what the provider can generate."""

    EXACT = "exact"
    """The provider generated exactly the requested duration."""

    TRIM_IN_POST = "trim_in_post"
    """A longer supported clip was generated; composition trims it."""


class AudioFormat(StrEnum):
    """Container/codec asked of a voice provider.

    ``wav`` is the project default for narration: it is lossless, every
    provider offers it, and FFmpeg reads it without a decoder surprise.
    """

    WAV = "wav"
    FLAC = "flac"
    MP3 = "mp3"
    AAC = "aac"
    OPUS = "opus"
    PCM = "pcm"

    @property
    def suffix(self) -> str:
        """File extension for this format."""
        return ".wav" if self is AudioFormat.PCM else f".{self.value}"

    @property
    def is_lossless(self) -> bool:
        """Whether the format keeps the provider's samples intact."""
        return self in (AudioFormat.WAV, AudioFormat.FLAC, AudioFormat.PCM)


class VoiceFitStrategy(StrEnum):
    """What to do when the narration does not fit the storyboard timeline."""

    FAIL = "fail"
    """Report the mismatch and stop. The narration is never rewritten."""

    REGENERATE = "regenerate"
    """Regenerate once at a supported speaking speed, within configured bounds."""


class AssetSource(StrEnum):
    """Where an asset came from."""

    GENERATED = "generated"
    BRAND = "brand"
    PLACEHOLDER = "placeholder"


class SceneTransition(StrEnum):
    """Transition into the following scene."""

    CUT = "cut"
    FADE = "fade"
    DISSOLVE = "dissolve"


class Platform(StrEnum):
    """Publication target."""

    INSTAGRAM_REEL = "instagram_reel"


class Language(StrEnum):
    """Narration language. See docs/development/OPEN_QUESTIONS.md."""

    RU = "ru"
    EN = "en"


class StageName(StrEnum):
    """Pipeline stages, in execution order."""

    ANALYZE = "analyze"
    PLAN = "plan"
    STORYBOARD = "storyboard"
    GENERATE_ASSETS = "generate-assets"
    GENERATE_VOICE = "generate-voice"
    COMPOSE = "compose"
    VALIDATE = "validate"
