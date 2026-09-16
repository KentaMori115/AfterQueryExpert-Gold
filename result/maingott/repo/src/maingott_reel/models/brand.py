"""Approved brand assets and the approved narration voice.

Nothing in this project may decide on its own that a logo or a voice is the
MainGott logo or the MainGott voice. Both are human decisions, recorded here
as explicit registry files under ``input/brand/`` and checked — never written
— by the release checker.

An asset that is present is not an asset that is approved: ``approved`` has to
be set deliberately, and the recorded hash has to still match the file.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import Field, model_validator

from maingott_reel.models.base import SCHEMA_VERSION, AssetType, Language, Schema

#: Bumped when the meaning of the registry changes.
BRAND_REGISTRY_VERSION = "1.0"
VOICE_PROFILE_VERSION = "1.0"


class BrandAsset(Schema):
    """One brand file and whether a human approved it."""

    asset_id: str = Field(min_length=1)
    asset_type: AssetType
    path: Path
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    version: str = "1.0"
    approved: bool = False
    approved_by: str | None = None
    approved_at: datetime | None = None
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    transparency: bool | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _approval_is_attributable(self) -> BrandAsset:
        if self.approved and not self.approved_by:
            raise ValueError(f"brand asset {self.asset_id} is approved but by nobody")
        return self


class BrandRegistry(Schema):
    """The approved brand assets, as recorded in ``input/brand/brand.json``."""

    schema_version: int = SCHEMA_VERSION
    version: str = BRAND_REGISTRY_VERSION
    note: str | None = Field(default=None, description="Free-text note; ignored by the code")
    updated_at: datetime | None = None
    assets: list[BrandAsset] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> BrandRegistry:
        ids = [asset.asset_id for asset in self.assets]
        if len(set(ids)) != len(ids):
            raise ValueError("brand asset ids must be unique")
        return self

    def by_type(self, asset_type: AssetType) -> list[BrandAsset]:
        """Every registered asset of ``asset_type``."""
        return [asset for asset in self.assets if asset.asset_type is asset_type]

    def approved_assets(self, asset_type: AssetType) -> list[BrandAsset]:
        """Every *approved* asset of ``asset_type``."""
        return [asset for asset in self.by_type(asset_type) if asset.approved]

    def find_by_hash(self, sha256: str) -> BrandAsset | None:
        """Return the registered asset with this content hash, if any."""
        return next((asset for asset in self.assets if asset.sha256 == sha256), None)

    def find_by_path(self, path: Path) -> BrandAsset | None:
        """Return the registered asset at this path, if any."""
        target = Path(path)
        return next((asset for asset in self.assets if Path(asset.path).name == target.name), None)


class VoiceProfile(Schema):
    """The narration voice a human approved for production.

    A documentation recommendation is not an approval. The release checker
    requires this file, requires ``approved``, and requires the voice actually
    used to match it exactly.
    """

    schema_version: int = SCHEMA_VERSION
    version: str = VOICE_PROFILE_VERSION
    note: str | None = Field(default=None, description="Free-text note; ignored by the code")
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    voice: str = Field(min_length=1)
    language: Language = Language.RU
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    approved: bool = False
    approved_by: str | None = None
    approved_at: datetime | None = None
    approval_notes: str | None = None

    @model_validator(mode="after")
    def _approval_is_attributable(self) -> VoiceProfile:
        if self.approved and not self.approved_by:
            raise ValueError("the voice profile is approved but by nobody")
        return self

    def matches(self, provider: str, model: str, voice: str, language: Language) -> bool:
        """Whether a generated track was made with the approved voice."""
        return (self.provider, self.model, self.voice, self.language) == (
            provider,
            model,
            voice,
            language,
        )

    def describe(self) -> str:
        """A one-line summary for reports."""
        return f"{self.provider}:{self.model} voice '{self.voice}' ({self.language.value})"
