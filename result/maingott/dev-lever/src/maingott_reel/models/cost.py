"""Cost estimation, budgets and the provider request log.

Generation is the only part of this pipeline that spends money, so it is the
part that must be predictable. Nothing here invents a price: a cost is either
derived from a pricing table the project configured deliberately, or it is
reported as unknown.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import Field, model_validator

from maingott_reel.models.base import SCHEMA_VERSION, Schema

#: Bumped when the shape of a generation plan changes.
GENERATION_PLAN_VERSION = "1.0"
PRICING_VERSION = "1.0"

#: What a cost line is measured in.
UNIT_SECONDS = "generated_seconds"
UNIT_CHARACTERS = "characters"


class GenerationKind(StrEnum):
    """What is being generated."""

    VIDEO = "video"
    VOICE = "voice"


class ModelPrice(Schema):
    """What one model costs, as configured by the project.

    Every field is optional on purpose: an unpriced model must produce an
    unknown cost, never a zero.
    """

    per_second_usd: float | None = Field(default=None, ge=0)
    per_1k_characters_usd: float | None = Field(default=None, ge=0)
    per_1m_tokens_usd: float | None = Field(
        default=None,
        ge=0,
        description="Speech models are billed per token, which this project cannot count "
        "exactly; a cost derived from this is an upper bound, never an invoice.",
    )
    notes: str | None = None

    @property
    def is_priced(self) -> bool:
        """Whether this entry carries any usable price."""
        return (
            self.per_second_usd is not None
            or self.per_1k_characters_usd is not None
            or self.per_1m_tokens_usd is not None
        )


class PricingTable(Schema):
    """Provider prices, supplied by the project — never by this code.

    ``source`` and ``verified_at`` exist so a number in a cost report can be
    traced back to whoever checked it against the provider's price list.
    """

    schema_version: int = SCHEMA_VERSION
    version: str = PRICING_VERSION
    note: str | None = Field(default=None, description="Free-text note; ignored by the code")
    currency: str = "USD"
    source: str | None = None
    verified_at: datetime | None = None
    video: dict[str, ModelPrice] = Field(default_factory=dict)
    voice: dict[str, ModelPrice] = Field(default_factory=dict)

    def price_for(self, kind: GenerationKind, model: str) -> ModelPrice | None:
        """Return the configured price for a model, if there is one."""
        table = self.video if kind is GenerationKind.VIDEO else self.voice
        price = table.get(model)
        return price if price is not None and price.is_priced else None


class CostLine(Schema):
    """What one kind of generation would cost."""

    kind: GenerationKind
    provider: str
    model: str
    calls: int = Field(ge=0)
    units: float = Field(ge=0)
    unit: str
    unit_price_usd: float | None = Field(default=None, ge=0)
    price_basis: str | None = Field(
        default=None, description="What the unit price is per, e.g. 'per 1M tokens'"
    )
    cost_usd: float | None = Field(default=None, ge=0)
    upper_bound: bool = Field(
        default=False,
        description="True when the cost is a ceiling rather than an exact figure",
    )
    detail: str | None = None

    @property
    def known(self) -> bool:
        """Whether this line has a price behind it."""
        return self.cost_usd is not None

    @property
    def price_label(self) -> str:
        """The unit price, said the way the provider says it."""
        if self.unit_price_usd is None:
            return "no verified price"
        return f"{self.unit_price_usd:g} {self.price_basis or f'per {self.unit}'}"

    @model_validator(mode="after")
    def _free_lines_are_free(self) -> CostLine:
        if self.calls == 0 and self.cost_usd not in (None, 0.0):
            raise ValueError("a line with no calls cannot cost anything")
        return self


class CostReport(Schema):
    """What a generation plan would cost, and whether that is affordable.

    ``known`` is false when any priced line could not be priced. A report that
    is not fully known has no total: an unknown cost is reported as unknown,
    never as zero.
    """

    currency: str = "USD"
    lines: list[CostLine] = Field(default_factory=list)
    budget_usd: float | None = Field(default=None, ge=0)
    pricing_source: str | None = None
    pricing_path: Path | None = None

    @property
    def calls(self) -> int:
        """How many paid calls the plan implies."""
        return sum(line.calls for line in self.lines)

    @property
    def payable_lines(self) -> list[CostLine]:
        """Lines that would actually be charged."""
        return [line for line in self.lines if line.calls > 0]

    @property
    def known(self) -> bool:
        """Whether every payable line could be priced."""
        return all(line.known for line in self.payable_lines)

    @property
    def total_usd(self) -> float | None:
        """Total cost, or ``None`` when any payable line is unpriced."""
        if not self.known:
            return None
        return round(sum(line.cost_usd or 0.0 for line in self.payable_lines), 4)

    @property
    def within_budget(self) -> bool | None:
        """``None`` when it cannot be decided (no budget, or unknown cost)."""
        if self.budget_usd is None:
            return None
        if self.calls == 0:
            return True
        total = self.total_usd
        return None if total is None else total <= self.budget_usd

    @property
    def is_upper_bound(self) -> bool:
        """Whether any payable line is a ceiling rather than an exact figure."""
        return any(line.upper_bound for line in self.payable_lines)

    def summary(self) -> str:
        """One line a human can act on."""
        if self.calls == 0:
            return "0 paid calls: everything is cached or already generated"
        total = self.total_usd
        prefix = "at most " if self.is_upper_bound else ""
        cost = f"{prefix}{total:.2f} {self.currency}" if total is not None else "COST UNKNOWN"
        budget = (
            f", budget {self.budget_usd:.2f} {self.currency}"
            if self.budget_usd is not None
            else ", no budget configured"
        )
        return f"{self.calls} paid call(s), {cost}{budget}"


class PlannedGeneration(Schema):
    """One thing the provider would be asked to make."""

    kind: GenerationKind
    identity: str = Field(min_length=1)
    scene_id: str | None = None
    provider: str
    model: str
    seconds: float | None = Field(default=None, gt=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    characters: int | None = Field(default=None, gt=0)
    cache_state: str = "generate"

    @property
    def needs_generation(self) -> bool:
        """Whether this item would be paid for."""
        return self.cache_state == "generate"


class GenerationPlan(Schema):
    """What a paid run would do, written down before it does it."""

    schema_version: int = SCHEMA_VERSION
    version: str = GENERATION_PLAN_VERSION
    run_id: str = Field(min_length=1)
    created_at: datetime
    dry_run: bool = True
    offline: bool = False
    configuration_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    items: list[PlannedGeneration] = Field(default_factory=list)
    cost: CostReport = Field(default_factory=CostReport)

    @property
    def planned_calls(self) -> int:
        """How many provider calls the plan implies."""
        return sum(1 for item in self.items if item.needs_generation)

    @property
    def cache_hits(self) -> int:
        """How many items are already available without paying."""
        return sum(1 for item in self.items if not item.needs_generation)

    def by_kind(self, kind: GenerationKind) -> list[PlannedGeneration]:
        """Every planned item of one kind."""
        return [item for item in self.items if item.kind is kind]


class RequestOutcome(StrEnum):
    """How a provider request ended."""

    CACHE_HIT = "cache_hit"
    SUCCESS = "success"
    RETRIED = "retried"
    FAILED = "failed"
    REJECTED = "rejected"


class ProviderRequestRecord(Schema):
    """One line of the provider request log.

    Enough to answer "what did we ask the provider to generate, and what came
    back" — and nothing that could carry a credential.
    """

    timestamp: datetime
    run_id: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    operation: str = Field(min_length=1)
    outcome: RequestOutcome
    identity: str | None = None
    scene_id: str | None = None
    prompt_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    narration_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    seconds: float | None = Field(default=None, gt=0)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    voice: str | None = None
    language: str | None = None
    speed: float | None = Field(default=None, gt=0)
    characters: int | None = Field(default=None, ge=0)
    attempt: int = Field(default=1, ge=1)
    max_attempts: int = Field(default=1, ge=1)
    paid: bool = True
    detail: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
