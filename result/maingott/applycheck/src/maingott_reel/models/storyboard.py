"""Timed storyboard schemas.

A storyboard turns the approved script plan into scenes a generator and a
compositor can execute: an exact, gapless timeline, one video prompt per
scene, and the voiceover and overlay text that post-production will lay on
top. Everything a viewer hears or reads is carried over from the plan
verbatim, so a storyboard cannot introduce a claim the planner never made.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field, model_validator

from maingott_reel.models.base import (
    SCHEMA_VERSION,
    AssetType,
    Language,
    SceneTransition,
    Schema,
)
from maingott_reel.models.provenance import STORYBOARD_VERSION, GenerationProvenance
from maingott_reel.models.validation import ValidationReport

#: Tolerance when comparing floating point scene timings, in seconds.
TIMING_TOLERANCE = 0.05


class AssetRequirement(Schema):
    """One media asset a scene needs."""

    asset_type: AssetType
    prompt: str = Field(min_length=3)
    duration_seconds: float | None = Field(default=None, gt=0)
    notes: str | None = None


class Scene(Schema):
    """One timed scene of the Reel."""

    id: str = Field(pattern=r"^S-\d{2,}$")
    beat_id: str = Field(pattern=r"^B-\d{2,}$", description="Script beat this scene realises")
    start_seconds: float = Field(ge=0)
    duration_seconds: float = Field(gt=0, le=20)
    purpose: str = Field(min_length=3)
    visual_description: str = Field(min_length=3)
    video_prompt: str = Field(min_length=3)
    voiceover: str = ""
    overlay_text: str = Field(default="", max_length=60)
    source_fact_ids: list[str] = Field(default_factory=list)
    asset_requirements: list[AssetRequirement] = Field(default_factory=list)
    transition: SceneTransition = SceneTransition.CUT

    @property
    def end_seconds(self) -> float:
        """Exclusive end of the scene."""
        return round(self.start_seconds + self.duration_seconds, 3)


class Storyboard(Schema):
    """The ordered, contiguous scene list for one Reel."""

    schema_version: int = SCHEMA_VERSION
    version: str = STORYBOARD_VERSION
    created_at: datetime
    language: Language = Language.RU
    target_duration_seconds: int = Field(ge=30, le=45)
    total_duration_seconds: float = Field(ge=30, le=45)
    narration_sha256: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="Hash of the plan narration this storyboard was built from",
    )
    scenes: list[Scene] = Field(min_length=1)
    source_fact_ids: list[str] = Field(default_factory=list)
    validation: ValidationReport
    provenance: GenerationProvenance

    @model_validator(mode="after")
    def _check_timeline(self) -> Storyboard:
        ids = [scene.id for scene in self.scenes]
        if len(set(ids)) != len(ids):
            raise ValueError("scene ids must be unique")
        beat_ids = [scene.beat_id for scene in self.scenes]
        if len(set(beat_ids)) != len(beat_ids):
            raise ValueError("each script beat may be realised by only one scene")

        cursor = 0.0
        for scene in self.scenes:
            if abs(scene.start_seconds - cursor) > TIMING_TOLERANCE:
                raise ValueError(
                    f"scene {scene.id} starts at {scene.start_seconds}s "
                    f"but the previous scene ends at {cursor}s"
                )
            cursor = scene.end_seconds

        if abs(cursor - self.total_duration_seconds) > TIMING_TOLERANCE:
            raise ValueError(
                f"scenes cover {cursor}s but total_duration_seconds is "
                f"{self.total_duration_seconds}s"
            )

        if self.source_fact_ids != self.fact_ids:
            raise ValueError("source_fact_ids must list exactly the facts cited by the scenes")
        return self

    @property
    def fact_ids(self) -> list[str]:
        """Every source fact id referenced by the storyboard, in scene order."""
        seen: list[str] = []
        for scene in self.scenes:
            for fact_id in scene.source_fact_ids:
                if fact_id not in seen:
                    seen.append(fact_id)
        return seen

    @property
    def scene_count(self) -> int:
        """Number of scenes."""
        return len(self.scenes)

    @property
    def passed(self) -> bool:
        """Whether deterministic validation accepted this storyboard."""
        return self.validation.passed

    def asset_requirements(self) -> list[AssetRequirement]:
        """Every asset the storyboard needs, in scene order."""
        return [requirement for scene in self.scenes for requirement in scene.asset_requirements]
