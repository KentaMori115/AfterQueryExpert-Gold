"""Run manifest, composition settings and validation report schemas."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import Field

from maingott_reel.models.base import SCHEMA_VERSION, Schema, StageName
from maingott_reel.models.composition import CompositionSettings
from maingott_reel.models.quality import QualityReport
from maingott_reel.models.release import ReleaseState
from maingott_reel.models.validation import ValidationReport


class ModelVersions(Schema):
    """Which provider models produced this run."""

    text: str | None = None
    image: str | None = None
    video: str | None = None
    voice: str | None = None


class StageRecord(Schema):
    """Bookkeeping for one completed pipeline stage."""

    stage: StageName
    completed_at: datetime
    artifact: Path | None = None
    notes: str | None = None


class CostEstimate(Schema):
    """Best-effort provider spend for one run."""

    currency: str = "USD"
    text_usd: float = 0.0
    image_usd: float = 0.0
    video_usd: float = 0.0
    voice_usd: float = 0.0

    @property
    def total_usd(self) -> float:
        """Sum of all recorded provider costs."""
        return round(self.text_usd + self.image_usd + self.video_usd + self.voice_usd, 4)


class RunManifest(Schema):
    """The record of one end-to-end generation run."""

    schema_version: int = SCHEMA_VERSION
    run_id: str = Field(min_length=1)
    created_at: datetime
    updated_at: datetime | None = None
    app_version: str
    source_path: Path | None = None
    source_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    prompt_version: str = "v1"
    models: ModelVersions = Field(default_factory=ModelVersions)
    stages: list[StageRecord] = Field(default_factory=list)
    files: dict[str, Path] = Field(default_factory=dict)
    composition: CompositionSettings | None = None
    validation: ValidationReport | None = None
    quality: QualityReport | None = None
    release_state: ReleaseState | None = Field(
        default=None, description="Where this run stands on the way to being publishable"
    )
    estimated_cost: CostEstimate = Field(default_factory=CostEstimate)

    def stage_completed(self, stage: StageName) -> bool:
        """Whether ``stage`` has already finished in this run."""
        return any(record.stage is stage for record in self.stages)

    def record_stage(
        self,
        stage: StageName,
        completed_at: datetime,
        artifact: Path | None = None,
        notes: str | None = None,
    ) -> None:
        """Add or replace the record for ``stage`` (keeps runs idempotent)."""
        record = StageRecord(stage=stage, completed_at=completed_at, artifact=artifact, notes=notes)
        self.stages = [item for item in self.stages if item.stage is not stage] + [record]
        self.updated_at = completed_at
