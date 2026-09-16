"""The schema the model is asked to fill in.

Structured Outputs constrains what a schema may contain: every field must be
required, defaults are not allowed, and string or numeric constraints are not
honoured. So the wire schema below is deliberately permissive and flat, and
:mod:`maingott_reel.creative.script_generator` converts it into the strict
application models where the real validation happens.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class DraftClaim(BaseModel):
    """A factual statement the advertisement makes, with its sources."""

    claim: str
    kind: Literal["factual", "target"]
    source_fact_ids: list[str]


class DraftBeat(BaseModel):
    """One planned beat of the Reel."""

    order: int
    kind: Literal["framing", "factual", "brand"]
    purpose: str
    narration: str
    on_screen_text: str
    visual_direction: str
    estimated_seconds: float
    claims: list[DraftClaim]


class DraftBrief(BaseModel):
    """The creative intent the model proposes."""

    objective: str
    audience: str
    tone: str
    visual_direction: str
    core_message: str
    supporting_messages: list[str]
    cta: str
    restrictions: list[str]
    source_fact_ids: list[str]


class CreativePlanDraft(BaseModel):
    """What the text provider returns for one planning request."""

    brief: DraftBrief
    beats: list[DraftBeat]


class DraftShot(BaseModel):
    """The visual treatment the model proposes for one script beat."""

    beat_id: str
    visual_description: str
    video_prompt: str
    transition: Literal["cut", "fade", "dissolve"]


class StoryboardDraft(BaseModel):
    """What the text provider returns for one storyboard request.

    Only the visual treatment is asked for. Timing, voiceover, overlays and
    fact references come from the approved plan, so the storyboard stage
    cannot introduce a claim of its own.
    """

    shots: list[DraftShot]
