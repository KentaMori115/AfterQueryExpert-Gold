"""How a generated artifact was produced.

Recorded by every stage that calls a provider, so a run can be audited or
reproduced: which prompts, which model, which facts were on the table.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from maingott_reel.models.base import Schema

#: Bumped when a generator's behaviour changes in a way that affects artifacts.
PLANNER_VERSION = "1.0"
STORYBOARD_VERSION = "1.0"


class GenerationProvenance(Schema):
    """Provenance of one generated artifact."""

    generator_version: str
    prompt_version: str
    system_prompt_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    user_prompt_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    provider: str
    model: str
    generated_at: datetime
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    offered_fact_ids: list[str] = Field(default_factory=list)
    attempts: int = Field(default=1, ge=1)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    target_facts_allowed: bool = False
