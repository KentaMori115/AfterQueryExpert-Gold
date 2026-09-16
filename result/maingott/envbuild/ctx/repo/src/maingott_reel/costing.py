"""Cost estimation and the generation budget.

Generation is the only part of this pipeline that spends money, so it is the
part that is written down before it happens. :func:`plan_generation` asks the
same questions the generation stages ask — what does the storyboard need, what
is already cached — without generating anything, and prices the answer against
a table the *project* supplied.

Nothing here invents a price. If a model is not in the pricing table, its cost
is unknown, and an unknown cost is reported as unknown rather than as zero.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.assets.cache import AssetCache
from maingott_reel.config import Settings
from maingott_reel.errors import BudgetExceededError, ConfigurationError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    UNIT_CHARACTERS,
    UNIT_SECONDS,
    CostLine,
    CostReport,
    GenerationKind,
    GenerationPlan,
    ModelPrice,
    PlannedGeneration,
    PricingTable,
)
from maingott_reel.release.configuration import configuration_sha256
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext

logger = get_logger("costing")

#: Both kinds of paid generation this pipeline performs.
ALL_KINDS = (GenerationKind.VIDEO, GenerationKind.VOICE)


def load_pricing(settings: Settings) -> PricingTable | None:
    """Load the project's pricing table, or ``None`` when there is none.

    A malformed table is reported rather than treated as absent: a price that
    cannot be read must never become a number a human would trust, and "no
    pricing" and "broken pricing" need different answers.

    Raises:
        ConfigurationError: the file exists but cannot be read.
    """
    path = settings.pricing_path
    if not path.is_file():
        return None
    try:
        return read_model(path, PricingTable)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise ConfigurationError(
            f"The pricing table at {path} cannot be read: {error}. Fix it or remove it — "
            "a malformed price file must not be mistaken for an absent one."
        ) from error


def _price_line(
    kind: GenerationKind,
    provider: str,
    model: str,
    calls: int,
    units: float,
    unit: str,
    pricing: PricingTable | None,
    detail: str | None = None,
) -> CostLine:
    """Price one kind of generation, or report it as unknown."""
    price: ModelPrice | None = None
    if pricing is not None and provider == "openai":
        price = pricing.price_for(kind, model)

    unit_price: float | None = None
    basis: str | None = None
    divisor = 1.0
    bound = False
    if price is not None and unit == UNIT_SECONDS:
        unit_price, basis = price.per_second_usd, "per generated second"
    elif price is not None:
        if price.per_1k_characters_usd is not None:
            unit_price, divisor = price.per_1k_characters_usd, 1000.0
            basis = "per 1k characters"
        elif price.per_1m_tokens_usd is not None:
            # Speech is billed per token, and this project cannot count tokens
            # without shipping a tokenizer. One token per character is a
            # ceiling for any tokenizer, so this is a bound, not a guess.
            unit_price, divisor, bound = price.per_1m_tokens_usd, 1_000_000.0, True
            basis = "per 1M tokens"

    cost: float | None = None
    if calls == 0:
        cost = 0.0
    elif provider != "openai":
        # The offline providers are free, and saying so is not a guess.
        cost = 0.0 if provider == "fake" else None
    elif unit_price is not None:
        cost = round(unit_price * units / divisor, 6)

    bounded = bound and calls > 0
    if bounded and detail:
        detail = f"{detail}; billed per token, priced at one token per character (a ceiling)"

    return CostLine(
        kind=kind,
        provider=provider,
        model=model,
        calls=calls,
        units=round(units, 3),
        unit=unit,
        unit_price_usd=unit_price if calls else None,
        price_basis=basis if calls else None,
        cost_usd=cost,
        upper_bound=bounded,
        detail=detail,
    )


def plan_generation(
    settings: Settings,
    run: RunContext,
    kinds: tuple[GenerationKind, ...] = ALL_KINDS,
    offline: bool = False,
    force: bool = False,
    cache: AssetCache | None = None,
    source_path: Path | None = None,
    created_at: datetime | None = None,
) -> GenerationPlan:
    """Work out what a paid run would do, and what it would cost.

    Generates nothing and needs no credentials: capabilities and cache state
    are both readable without an API key.

    Raises:
        StageNotCompletedError: the run has no current, valid storyboard.
        ConfigurationError: the configured providers cannot serve this run.
    """
    # Imported here: the generation stages depend on this module for their
    # budget check, so importing them at module level would be circular.
    from maingott_reel.assets import manager as asset_manager
    from maingott_reel.audio import voice as voice_stage

    storyboard, plan, registry = voice_stage.load_upstream(run)
    asset_manager.check_inputs(settings, run, storyboard, plan, registry, source_path)

    asset_cache = cache or AssetCache(settings.asset_cache_root)
    pricing = load_pricing(settings)
    items: list[PlannedGeneration] = []
    lines: list[CostLine] = []

    if GenerationKind.VIDEO in kinds:
        provider_name, model = asset_manager.video_provider_identity(settings, offline)
        video_caps = asset_manager.video_capabilities(settings, offline)
        asset_plan = asset_manager.plan_assets(
            settings=settings,
            run=run,
            board=storyboard,
            capabilities=video_caps,
            provider_name=provider_name,
            model=model,
            cache=asset_cache,
            force=force,
        )
        for planned in asset_plan.planned:
            clip = planned.request
            items.append(
                PlannedGeneration(
                    kind=GenerationKind.VIDEO,
                    identity=clip.asset_id,
                    scene_id=clip.scene_id,
                    provider=provider_name,
                    model=model,
                    seconds=float(clip.generated_seconds),
                    width=clip.width,
                    height=clip.height,
                    cache_state="generate" if planned.needs_generation else "cached",
                )
            )
        billable = [item for item in asset_plan.planned if item.needs_generation]
        lines.append(
            _price_line(
                kind=GenerationKind.VIDEO,
                provider=provider_name,
                model=model,
                calls=len(billable),
                units=float(sum(item.request.generated_seconds for item in billable)),
                unit=UNIT_SECONDS,
                pricing=pricing,
                detail=f"{len(asset_plan.planned) - len(billable)} of "
                f"{len(asset_plan.planned)} scenes already available",
            )
        )

    if GenerationKind.VOICE in kinds:
        provider_name, model, voice_name = voice_stage.voice_provider_identity(settings, offline)
        voice_caps = voice_stage.voice_capabilities(settings, offline)
        instructions, prompt_version = voice_stage.voice_direction(settings)
        spoken = voice_stage.build_request(
            settings=settings,
            storyboard=storyboard,
            plan=plan,
            registry=registry,
            run=run,
            capabilities=voice_caps,
            provider_name=provider_name,
            model=model,
            voice_name=voice_name,
            instructions=instructions,
            prompt_version=prompt_version,
        )
        voice_plan = voice_stage.plan_voice(run, spoken, voice_caps, asset_cache, force=force)
        items.append(
            PlannedGeneration(
                kind=GenerationKind.VOICE,
                identity=spoken.voice_id,
                provider=provider_name,
                model=model,
                characters=spoken.characters,
                cache_state="generate" if voice_plan.needs_generation else "cached",
            )
        )
        lines.append(
            _price_line(
                kind=GenerationKind.VOICE,
                provider=provider_name,
                model=model,
                calls=voice_plan.generation_count,
                units=float(spoken.characters if voice_plan.needs_generation else 0),
                unit=UNIT_CHARACTERS,
                pricing=pricing,
                detail=f"voice '{voice_name}', {spoken.characters} characters, "
                f"{voice_plan.cache_state}",
            )
        )

    report = CostReport(
        currency=pricing.currency if pricing else "USD",
        lines=lines,
        budget_usd=settings.max_generation_cost,
        pricing_source=pricing.source if pricing else None,
        pricing_path=settings.pricing_path if pricing else None,
    )
    return GenerationPlan(
        run_id=run.run_id,
        created_at=created_at or datetime.now(tz=UTC),
        dry_run=True,
        offline=offline,
        configuration_sha256=configuration_sha256(settings),
        items=items,
        cost=report,
    )


def write_plan(run: RunContext, plan: GenerationPlan) -> Path:
    """Persist the generation plan so a human can read it before paying."""
    return write_model(run.generation_plan_json, plan)


def enforce_budget(
    plan: GenerationPlan,
    settings: Settings,
    allow_over_budget: bool = False,
) -> None:
    """Refuse to start paid generation that the budget does not cover.

    An unknown cost is not treated as an affordable one: when a budget is
    configured and the price cannot be established, generation stops until
    either the pricing table is filled in or the override is passed
    deliberately.

    Raises:
        BudgetExceededError: the plan is not covered by the configured budget.
    """
    cost = plan.cost
    if plan.planned_calls == 0 or plan.offline:
        return

    budget = settings.max_generation_cost
    if budget is None:
        logger.warning(
            "no generation budget is configured",
            extra={"calls": plan.planned_calls, "cost_known": cost.known},
        )
        return

    if allow_over_budget:
        logger.warning(
            "budget override accepted",
            extra={"calls": plan.planned_calls, "budget_usd": budget},
        )
        return

    if not cost.known:
        raise BudgetExceededError(
            f"A budget of {budget:.2f} {cost.currency} is configured but the cost of "
            f"{plan.planned_calls} call(s) is unknown: no verified price for "
            f"{', '.join(sorted({line.model for line in cost.payable_lines if not line.known}))}. "
            f"Add the price to {settings.pricing_path}, or pass --allow-over-budget to "
            "generate anyway."
        )
    total = cost.total_usd or 0.0
    if total > budget:
        raise BudgetExceededError(
            f"Generation would cost {total:.2f} {cost.currency}, over the configured budget of "
            f"{budget:.2f} {cost.currency}. Reduce the work, raise MAX_GENERATION_COST, or pass "
            "--allow-over-budget to generate anyway."
        )
