"""Creative brief and script plan schemas.

These are the Phase 2 artifacts. They are deliberately stricter than what the
model is asked to produce: the provider returns a permissive draft, and the
planner converts it into these models, so a malformed or unsupported plan
fails here rather than downstream.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field, model_validator

from maingott_reel.models.base import (
    SCHEMA_VERSION,
    BeatKind,
    ClaimKind,
    Language,
    Platform,
    Schema,
)
from maingott_reel.models.provenance import PLANNER_VERSION, GenerationProvenance
from maingott_reel.models.validation import ValidationReport


class ClaimReference(Schema):
    """A factual statement together with the facts that support it."""

    claim: str = Field(min_length=3, description="The wording used in the advertisement")
    kind: ClaimKind = ClaimKind.FACTUAL
    source_fact_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _fact_ids_are_unique_and_well_formed(self) -> ClaimReference:
        if any(not fact_id.strip() for fact_id in self.source_fact_ids):
            raise ValueError("source_fact_ids must not contain empty ids")
        if len(set(self.source_fact_ids)) != len(self.source_fact_ids):
            raise ValueError("source_fact_ids must not repeat the same fact")
        return self


class ScriptBeat(Schema):
    """One conceptual beat of the Reel.

    A beat is not a scene: it carries narration and intent, while timing and
    visual assets are decided by the storyboard stage.
    """

    id: str = Field(pattern=r"^B-\d{2,}$")
    order: int = Field(ge=1)
    kind: BeatKind
    purpose: str = Field(min_length=3)
    narration: str = Field(min_length=1)
    on_screen_text: str = Field(default="", max_length=60)
    visual_direction: str = Field(min_length=3)
    estimated_seconds: float = Field(gt=0, le=20)
    claims: list[ClaimReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def _claims_match_the_beat_kind(self) -> ScriptBeat:
        if self.kind is BeatKind.FRAMING and self.claims:
            raise ValueError(f"framing beat {self.id} must not carry factual claims")
        if self.kind is not BeatKind.FRAMING and not self.claims:
            raise ValueError(f"{self.kind.value} beat {self.id} must cite at least one fact")
        return self

    @property
    def source_fact_ids(self) -> list[str]:
        """Every fact id cited by this beat, in first-seen order."""
        seen: list[str] = []
        for claim in self.claims:
            for fact_id in claim.source_fact_ids:
                if fact_id not in seen:
                    seen.append(fact_id)
        return seen


class CreativeBrief(Schema):
    """The advertising intent for one Reel."""

    schema_version: int = SCHEMA_VERSION
    version: str = PLANNER_VERSION
    objective: str = Field(min_length=10)
    audience: str = Field(min_length=3)
    platform: Platform = Platform.INSTAGRAM_REEL
    aspect_ratio: str = "9:16"
    target_duration_seconds: int = Field(ge=30, le=45)
    language: Language = Language.RU
    tone: str = Field(min_length=3)
    visual_direction: str = Field(min_length=3)
    core_message: str = Field(min_length=3)
    supporting_messages: list[str] = Field(default_factory=list)
    cta: str = Field(min_length=2)
    restrictions: list[str] = Field(
        default_factory=list,
        description="Hard constraints, e.g. 'no team members', 'no invented metrics'",
    )
    source_fact_ids: list[str] = Field(default_factory=list)


class ScriptPlan(Schema):
    """The validated narration plan for one Reel."""

    schema_version: int = SCHEMA_VERSION
    version: str = PLANNER_VERSION
    created_at: datetime
    language: Language = Language.RU
    target_duration_seconds: int = Field(ge=30, le=45)
    total_estimated_seconds: float = Field(gt=0, le=60)
    narration: str = Field(min_length=1, description="Full narration, one line per beat")
    beats: list[ScriptBeat] = Field(min_length=1)
    source_fact_ids: list[str] = Field(default_factory=list)
    claims: list[ClaimReference] = Field(default_factory=list)
    validation: ValidationReport
    provenance: GenerationProvenance

    @model_validator(mode="after")
    def _internally_consistent(self) -> ScriptPlan:
        orders = [beat.order for beat in self.beats]
        if orders != sorted(orders) or len(set(orders)) != len(orders):
            raise ValueError("beats must have unique, ascending order values")
        ids = [beat.id for beat in self.beats]
        if len(set(ids)) != len(ids):
            raise ValueError("beat ids must be unique")

        expected_total = round(sum(beat.estimated_seconds for beat in self.beats), 3)
        if abs(expected_total - self.total_estimated_seconds) > 0.05:
            raise ValueError(
                f"total_estimated_seconds is {self.total_estimated_seconds}s "
                f"but the beats add up to {expected_total}s"
            )

        expected_facts = self._collect_fact_ids()
        if self.source_fact_ids != expected_facts:
            raise ValueError("source_fact_ids must list exactly the facts cited by the beats")

        expected_claims = [claim for beat in self.beats for claim in beat.claims]
        if self.claims != expected_claims:
            raise ValueError("claims must mirror the claims carried by the beats")

        expected_narration = "\n".join(beat.narration for beat in self.beats)
        if self.narration != expected_narration:
            raise ValueError("narration must be the beat narrations joined in order")
        return self

    def _collect_fact_ids(self) -> list[str]:
        seen: list[str] = []
        for beat in self.beats:
            for fact_id in beat.source_fact_ids:
                if fact_id not in seen:
                    seen.append(fact_id)
        return seen

    @property
    def passed(self) -> bool:
        """Whether deterministic validation accepted this plan."""
        return self.validation.passed

    @property
    def beat_count(self) -> int:
        """Number of beats in the plan."""
        return len(self.beats)
