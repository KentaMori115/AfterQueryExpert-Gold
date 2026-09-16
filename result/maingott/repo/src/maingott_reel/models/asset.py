"""Generated asset schemas.

An asset record must answer, on its own: which storyboard scene it belongs to,
which prompt and model produced it, what was asked for, what actually came
back, and whether the file passed validation.
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
    DurationStrategy,
    Schema,
)
from maingott_reel.models.validation import ValidationReport

#: Bumped when asset identity or the generation contract changes.
ASSET_GENERATION_VERSION = "1.0"


class Asset(Schema):
    """One media file produced for a storyboard scene."""

    id: str = Field(min_length=1)
    asset_type: AssetType
    status: AssetStatus = AssetStatus.PENDING
    source: AssetSource = AssetSource.GENERATED

    # --- what it belongs to ------------------------------------------------
    scene_id: str | None = Field(default=None, pattern=r"^S-\d{2,}$")
    beat_id: str | None = Field(default=None, pattern=r"^B-\d{2,}$")

    # --- what was asked for -------------------------------------------------
    provider: str | None = None
    model: str | None = None
    prompt: str | None = None
    prompt_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    prompt_version: str | None = None
    cache_key: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    requested_duration_seconds: float | None = Field(default=None, gt=0)
    generated_duration_seconds: float | None = Field(default=None, gt=0)
    duration_strategy: DurationStrategy | None = None
    requested_width: int | None = Field(default=None, gt=0)
    requested_height: int | None = Field(default=None, gt=0)

    # --- what came back -----------------------------------------------------
    path: Path | None = None
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    size_bytes: int | None = Field(default=None, ge=0)
    actual_duration_seconds: float | None = Field(default=None, gt=0)
    actual_width: int | None = Field(default=None, gt=0)
    actual_height: int | None = Field(default=None, gt=0)
    codec: str | None = None
    frame_rate: float | None = Field(default=None, gt=0)

    # --- bookkeeping ---------------------------------------------------------
    created_at: datetime | None = None
    attempts: int = Field(default=0, ge=0)
    cache_hit: bool = False
    generation_metadata: dict[str, Any] = Field(default_factory=dict)
    validation: ValidationReport | None = None
    error: str | None = None

    @model_validator(mode="after")
    def _ready_assets_have_a_verified_file(self) -> Asset:
        if self.status in (AssetStatus.READY, AssetStatus.CACHED):
            if self.path is None:
                raise ValueError(f"asset {self.id} is {self.status} but has no path")
            if self.sha256 is None:
                raise ValueError(f"asset {self.id} is {self.status} but has no sha256")
            if self.validation is not None and not self.validation.passed:
                raise ValueError(f"asset {self.id} is {self.status} but failed validation")
        if self.status is AssetStatus.FAILED and not self.error:
            raise ValueError(f"asset {self.id} failed but carries no error message")
        return self

    @property
    def is_usable(self) -> bool:
        """Whether composition may use this asset."""
        return self.status in (AssetStatus.READY, AssetStatus.CACHED)


class AssetCollection(Schema):
    """Every asset generated for one run, with the inputs that defined them."""

    schema_version: int = SCHEMA_VERSION
    generation_version: str = ASSET_GENERATION_VERSION
    created_at: datetime
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    storyboard_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    narration_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    provider: str
    model: str
    assets: list[Asset] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> AssetCollection:
        ids = [asset.id for asset in self.assets]
        if len(set(ids)) != len(ids):
            raise ValueError("asset ids must be unique")
        scenes = [asset.scene_id for asset in self.assets if asset.scene_id is not None]
        if len(set(scenes)) != len(scenes):
            raise ValueError("a scene may hold only one asset of the same identity")
        return self

    def get(self, asset_id: str) -> Asset | None:
        """Return the asset with ``asset_id`` if present."""
        return next((asset for asset in self.assets if asset.id == asset_id), None)

    def for_scene(self, scene_id: str) -> Asset | None:
        """Return the asset generated for ``scene_id`` if present."""
        return next((asset for asset in self.assets if asset.scene_id == scene_id), None)

    def by_type(self, asset_type: AssetType) -> list[Asset]:
        """Return every asset of ``asset_type``."""
        return [asset for asset in self.assets if asset.asset_type is asset_type]

    @property
    def ready(self) -> list[Asset]:
        """Assets composition can use."""
        return [asset for asset in self.assets if asset.is_usable]

    @property
    def pending(self) -> list[Asset]:
        """Assets that still need generation (used for resumable runs)."""
        return [asset for asset in self.assets if not asset.is_usable]

    @property
    def failed(self) -> list[Asset]:
        """Assets whose generation or validation failed."""
        return [asset for asset in self.assets if asset.status is AssetStatus.FAILED]

    @property
    def cache_hits(self) -> int:
        """How many assets came from the cache."""
        return sum(1 for asset in self.assets if asset.cache_hit)

    @property
    def complete(self) -> bool:
        """Whether every declared asset is usable."""
        return bool(self.assets) and all(asset.is_usable for asset in self.assets)
