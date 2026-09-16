"""The ``generate-assets`` stage.

Turns an approved storyboard into generated media files. The storyboard is
authoritative: this stage generates exactly what the scenes declare and never
changes the creative decisions behind them. Assets are content-addressed and
cached, so a re-run costs nothing for footage that already exists, and a
failure in one scene does not throw away the others.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.assets.cache import AssetCache
from maingott_reel.assets.identity import AssetRequest
from maingott_reel.assets.probe import MediaInfo, MediaProbe, default_probe
from maingott_reel.assets.validation import failure_summary, validate_asset_file
from maingott_reel.config import Settings
from maingott_reel.creative.claims import validate_storyboard
from maingott_reel.errors import (
    ConfigurationError,
    ProviderError,
    StageNotCompletedError,
    TransientProviderError,
)
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    ASSET_GENERATION_VERSION,
    Asset,
    AssetCollection,
    AssetStatus,
    AssetType,
    DurationStrategy,
    FactRegistry,
    GenerationKind,
    RequestOutcome,
    Scene,
    ScriptPlan,
    StageName,
    Storyboard,
    ValidationReport,
)
from maingott_reel.providers.base import VideoCapabilities, VideoProvider
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.request_log import RequestLog
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("assets.manager")

#: Only video assets are declared by storyboards today.
SUPPORTED_ASSET_TYPES = (AssetType.VIDEO,)

#: The offline provider's name. Work attributed to it is never billed.
FAKE_PROVIDER_NAME = "fake"


@dataclass(frozen=True)
class PlannedAsset:
    """One asset the run needs, with what it would cost to get it."""

    request: AssetRequest
    scene: Scene
    reused: bool = False
    cached: bool = False
    kept_failed: bool = False
    previous: Asset | None = None

    @property
    def needs_generation(self) -> bool:
        """Whether the provider has to be called for this asset."""
        return not (self.reused or self.cached or self.kept_failed)

    @property
    def carried_over(self) -> bool:
        """Whether the previous record is taken as it stands."""
        return self.reused or self.kept_failed


@dataclass(frozen=True)
class AssetPlan:
    """What ``generate-assets`` would do, before it does anything."""

    provider: str
    model: str
    capabilities: VideoCapabilities
    planned: list[PlannedAsset] = field(default_factory=list)

    @property
    def reused(self) -> list[PlannedAsset]:
        """Assets already generated in this run."""
        return [item for item in self.planned if item.reused]

    @property
    def cache_hits(self) -> list[PlannedAsset]:
        """Assets available from the shared cache."""
        return [item for item in self.planned if item.cached and not item.reused]

    @property
    def kept_failed(self) -> list[PlannedAsset]:
        """Assets left failed because a retry was not asked for."""
        return [item for item in self.planned if item.kept_failed]

    @property
    def to_generate(self) -> list[PlannedAsset]:
        """Assets that require a paid generation."""
        return [item for item in self.planned if item.needs_generation]


@dataclass(frozen=True)
class AssetsResult:
    """What the stage produced."""

    run: RunContext
    plan: AssetPlan
    collection: AssetCollection | None
    dry_run: bool

    @property
    def complete(self) -> bool:
        """Whether every declared asset is usable."""
        return self.collection is not None and self.collection.complete

    @property
    def failed(self) -> list[Asset]:
        """Assets that could not be produced."""
        return list(self.collection.failed) if self.collection else []


# --- loading and preconditions -------------------------------------------


def _load(run: RunContext) -> tuple[Storyboard, ScriptPlan, FactRegistry]:
    """Load the artifacts this stage depends on.

    Raises:
        StageNotCompletedError: an artifact is missing or unreadable.
    """
    run.require(run.storyboard_json, "storyboard")
    run.require(run.script_json, "plan")
    run.require(run.facts_json, "analyze")
    try:
        board = read_model(run.storyboard_json, Storyboard)
        plan = read_model(run.script_json, ScriptPlan)
        registry = read_model(run.facts_json, FactRegistry)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"Run {run.run_id} has unreadable artifacts ({error}). Re-run the earlier stages."
        ) from error
    return board, plan, registry


def check_inputs(
    settings: Settings,
    run: RunContext,
    board: Storyboard,
    plan: ScriptPlan,
    registry: FactRegistry,
    source_path: Path | None = None,
) -> None:
    """Refuse to generate anything from a storyboard that is not current.

    Raises:
        StageNotCompletedError: the storyboard is stale, was rejected, or no
            longer matches the plan, the facts or the source document.
    """
    if not board.passed:
        raise StageNotCompletedError(
            f"The storyboard in run {run.run_id} did not pass validation. Re-run 'storyboard'."
        )
    if not plan.passed:
        raise StageNotCompletedError(
            f"The plan in run {run.run_id} did not pass validation. Re-run 'plan'."
        )
    if board.narration_sha256 != sha256_text(plan.narration):
        raise StageNotCompletedError(
            f"The storyboard in run {run.run_id} was built from a different plan. "
            "Re-run 'storyboard'."
        )
    if board.provenance.source_sha256 != registry.source_sha256:
        raise StageNotCompletedError(
            f"The storyboard in run {run.run_id} was built from different facts. "
            "Re-run 'plan' and 'storyboard'."
        )
    if plan.provenance.source_sha256 != registry.source_sha256:
        raise StageNotCompletedError(
            f"The plan in run {run.run_id} was built from different facts. Re-run 'plan'."
        )
    path = source_path or settings.source_document
    if path.is_file() and sha256_file(path) != registry.source_sha256:
        raise StageNotCompletedError(
            f"{path.name} changed since the analysis of run {run.run_id}. Re-run 'analyze'."
        )

    # The storyboard rules still apply: re-run them rather than restating them.
    report = validate_storyboard(board.scenes, plan, board.target_duration_seconds)
    if not report.passed:
        failures = "; ".join(f"{check.name}: {check.detail}" for check in report.failures)
        raise StageNotCompletedError(
            f"The storyboard in run {run.run_id} no longer validates: {failures}"
        )

    unsupported = {
        requirement.asset_type
        for scene in board.scenes
        for requirement in scene.asset_requirements
        if requirement.asset_type not in SUPPORTED_ASSET_TYPES
    }
    if unsupported:
        names = ", ".join(sorted(asset_type.value for asset_type in unsupported))
        raise StageNotCompletedError(
            f"The storyboard declares asset types this stage cannot generate yet: {names}."
        )


# --- planning -------------------------------------------------------------


def build_request(
    scene: Scene,
    board: Storyboard,
    settings: Settings,
    capabilities: VideoCapabilities,
    provider_name: str,
    model: str,
) -> AssetRequest:
    """Resolve one scene into a generatable request.

    Raises:
        StageNotCompletedError: the provider cannot serve this scene.
    """
    requirement = next(
        (r for r in scene.asset_requirements if r.asset_type is AssetType.VIDEO), None
    )
    if requirement is None:
        raise StageNotCompletedError(f"Scene {scene.id} declares no video asset.")

    seconds = capabilities.seconds_for(scene.duration_seconds)
    if seconds is None:
        raise StageNotCompletedError(
            f"Scene {scene.id} needs {scene.duration_seconds}s but {model} generates only "
            f"{capabilities.supported_seconds}s clips. Shorten the scene or change the model."
        )
    size = capabilities.best_portrait_size(settings.video_width, settings.video_height)
    if size is None:
        raise StageNotCompletedError(
            f"{model} offers no portrait size; this Reel is "
            f"{settings.video_width}x{settings.video_height}."
        )
    if len(requirement.prompt) > capabilities.max_prompt_chars:
        raise StageNotCompletedError(
            f"Scene {scene.id} has a {len(requirement.prompt)} character prompt; "
            f"{model} accepts {capabilities.max_prompt_chars}."
        )

    strategy = (
        DurationStrategy.EXACT
        if abs(seconds - scene.duration_seconds) < 0.01
        else DurationStrategy.TRIM_IN_POST
    )
    return AssetRequest(
        scene_id=scene.id,
        beat_id=scene.beat_id,
        asset_type=AssetType.VIDEO,
        prompt=requirement.prompt,
        provider=provider_name,
        model=model,
        requested_duration_seconds=scene.duration_seconds,
        generated_seconds=seconds,
        width=size[0],
        height=size[1],
        duration_strategy=strategy,
        source_sha256=board.provenance.source_sha256,
        prompt_version=board.provenance.prompt_version,
        settings={"generation_version": ASSET_GENERATION_VERSION},
    )


def _existing_assets(run: RunContext) -> dict[str, Asset]:
    """Load the assets a previous run of this stage produced."""
    if not run.assets_json.is_file():
        return {}
    try:
        collection = read_model(run.assets_json, AssetCollection)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("existing assets.json is unreadable", extra={"error": str(error)})
        return {}
    return {asset.id: asset for asset in collection.assets}


def _still_usable(asset: Asset) -> bool:
    """Whether a previously generated asset can be reused as it stands."""
    if not asset.is_usable or asset.path is None or asset.sha256 is None:
        return False
    if not asset.path.is_file():
        logger.warning("previously generated asset is missing", extra={"asset": asset.id})
        return False
    if sha256_file(asset.path) != asset.sha256:
        logger.warning("previously generated asset changed on disk", extra={"asset": asset.id})
        return False
    return True


def plan_assets(
    settings: Settings,
    run: RunContext,
    board: Storyboard,
    capabilities: VideoCapabilities,
    provider_name: str,
    model: str,
    cache: AssetCache,
    retry_failed: bool = True,
    force: bool = False,
) -> AssetPlan:
    """Work out what has to be generated, without generating anything."""
    existing = _existing_assets(run)
    planned: list[PlannedAsset] = []
    for scene in board.scenes:
        request = build_request(scene, board, settings, capabilities, provider_name, model)
        previous = existing.get(request.asset_id)
        reusable = not force and previous is not None and _still_usable(previous)
        # A failure is only retried when the caller asks for it, so a run can
        # be inspected without paying for the same failing scene again.
        kept_failed = (
            not force
            and not reusable
            and previous is not None
            and previous.status is AssetStatus.FAILED
            and not retry_failed
        )
        cached = (
            not force
            and not reusable
            and not kept_failed
            and cache.lookup(request.cache_key) is not None
        )
        planned.append(
            PlannedAsset(
                request=request,
                scene=scene,
                reused=reusable,
                cached=cached,
                kept_failed=kept_failed,
                previous=previous,
            )
        )
    return AssetPlan(
        provider=provider_name, model=model, capabilities=capabilities, planned=planned
    )


# --- generation -----------------------------------------------------------


def _scene_dir(run: RunContext, scene_id: str) -> Path:
    """Directory holding one scene's assets, e.g. ``assets/scene_01``."""
    _, _, number = scene_id.partition("-")
    return run.assets_dir / f"scene_{number}"


def _asset_path(run: RunContext, scene_id: str) -> Path:
    """Where a scene's video file lives inside the run."""
    return _scene_dir(run, scene_id) / "video.mp4"


def _record_metadata(run: RunContext, asset: Asset) -> None:
    """Write the per-scene metadata sidecar."""
    if asset.scene_id is None:
        return
    write_model(_scene_dir(run, asset.scene_id) / "metadata.json", asset)


def _asset_from(
    request: AssetRequest,
    status: AssetStatus,
    path: Path | None = None,
    sha256: str | None = None,
    **extra: object,
) -> Asset:
    """Build an asset record from a request."""
    return Asset(
        id=request.asset_id,
        asset_type=request.asset_type,
        status=status,
        scene_id=request.scene_id,
        beat_id=request.beat_id,
        provider=request.provider,
        model=request.model,
        prompt=request.normalized_prompt,
        prompt_hash=request.prompt_hash,
        prompt_version=request.prompt_version,
        cache_key=request.cache_key,
        requested_duration_seconds=request.requested_duration_seconds,
        generated_duration_seconds=float(request.generated_seconds),
        duration_strategy=request.duration_strategy,
        requested_width=request.width,
        requested_height=request.height,
        path=path,
        sha256=sha256,
        created_at=datetime.now(tz=UTC),
        **extra,
    )


def _generate_one(
    item: PlannedAsset,
    run: RunContext,
    provider: VideoProvider,
    cache: AssetCache,
    probe: MediaProbe,
    max_attempts: int,
    use_cache: bool = True,
    log: RequestLog | None = None,
    paid: bool = True,
) -> Asset:
    """Produce one asset, from the cache or the provider, and validate it."""
    request = item.request
    destination = _asset_path(run, request.scene_id)

    def _record(outcome: RequestOutcome, attempt: int, detail: str | None = None) -> None:
        """Note what was asked of the provider, without any credential in it."""
        if log is None:
            return
        log.record(
            provider=request.provider,
            model=request.model,
            operation="video.generate",
            outcome=outcome,
            paid=paid and outcome is not RequestOutcome.CACHE_HIT,
            identity=request.asset_id,
            scene_id=request.scene_id,
            prompt_sha256=request.prompt_hash,
            seconds=float(request.generated_seconds),
            width=request.width,
            height=request.height,
            attempt=attempt,
            max_attempts=max_attempts,
            detail=detail,
        )

    entry = cache.lookup(request.cache_key) if use_cache else None
    if entry is not None:
        cache.copy_into(entry, destination)
        report, info = validate_asset_file(destination, request, probe)
        if report.passed:
            logger.info("asset served from cache", extra=request.describe())
            _record(RequestOutcome.CACHE_HIT, attempt=1, detail="served from the asset cache")
            return _finish(request, destination, report, info, cached=True, attempts=0)
        logger.warning(
            "cached asset failed validation, regenerating",
            extra={"asset": request.asset_id, "detail": failure_summary(report)},
        )
        cache.discard(request.cache_key)

    last_error = "generation was never attempted"
    for attempt in range(1, max_attempts + 1):
        try:
            result = provider.generate_video(
                prompt=request.normalized_prompt,
                seconds=request.generated_seconds,
                width=request.width,
                height=request.height,
                destination=destination,
            )
        except TransientProviderError as error:
            last_error = str(error)
            logger.warning(
                "generation failed, retrying",
                extra={"asset": request.asset_id, "attempt": attempt, "error": last_error},
            )
            _record(RequestOutcome.RETRIED, attempt, last_error)
            continue
        except (ProviderError, ConfigurationError) as error:
            # Not worth retrying: the request itself is unacceptable.
            logger.error(
                "generation failed", extra={"asset": request.asset_id, "error": str(error)}
            )
            _record(RequestOutcome.REJECTED, attempt, str(error))
            return _asset_from(request, AssetStatus.FAILED, error=str(error), attempts=attempt)

        report, info = validate_asset_file(destination, request, probe)
        if not report.passed:
            last_error = failure_summary(report)
            logger.warning(
                "generated asset failed validation",
                extra={"asset": request.asset_id, "attempt": attempt, "detail": last_error},
            )
            _record(RequestOutcome.FAILED, attempt, last_error)
            destination.unlink(missing_ok=True)
            continue

        cache.store(request.cache_key, destination, request.describe())
        logger.info(
            "asset generated",
            extra={**request.describe(), "attempt": attempt, "usage_model": result.usage.model},
        )
        _record(RequestOutcome.SUCCESS, attempt)
        return _finish(
            request,
            destination,
            report,
            info,
            cached=False,
            attempts=attempt,
            metadata=dict(result.metadata),
        )

    _record(RequestOutcome.FAILED, max_attempts, f"gave up after {max_attempts} attempts")
    return _asset_from(
        request,
        AssetStatus.FAILED,
        error=f"after {max_attempts} attempts: {last_error}",
        attempts=max_attempts,
    )


def _finish(
    request: AssetRequest,
    path: Path,
    report: ValidationReport,
    info: MediaInfo | None,
    cached: bool,
    attempts: int,
    metadata: dict[str, object] | None = None,
) -> Asset:
    """Build the record for a successfully validated asset."""
    return _asset_from(
        request,
        AssetStatus.CACHED if cached else AssetStatus.READY,
        path=path,
        sha256=sha256_file(path),
        size_bytes=path.stat().st_size,
        actual_duration_seconds=info.duration_seconds if info else None,
        actual_width=(info.width or None) if info else None,
        actual_height=(info.height or None) if info else None,
        codec=(info.codec or None) if info else None,
        frame_rate=info.frame_rate if info else None,
        cache_hit=cached,
        attempts=attempts,
        validation=report,
        generation_metadata=metadata or {},
    )


# --- provider selection ----------------------------------------------------


def video_provider_identity(settings: Settings, offline: bool) -> tuple[str, str]:
    """Return the provider name and model that will be used."""
    if offline:
        from maingott_reel.providers.fake import FAKE_PROVIDER_NAME, OFFLINE_VIDEO_MODEL

        return FAKE_PROVIDER_NAME, OFFLINE_VIDEO_MODEL
    return "openai", settings.openai_video_model


def video_capabilities(settings: Settings, offline: bool) -> VideoCapabilities:
    """Return the capabilities of the provider that will be used.

    Reading capabilities never needs credentials, so a dry run works without
    an API key.
    """
    if offline:
        from maingott_reel.providers.fake import OFFLINE_VIDEO_CAPABILITIES

        return OFFLINE_VIDEO_CAPABILITIES
    from maingott_reel.providers.openai_provider import SORA_CAPABILITIES

    return SORA_CAPABILITIES


def build_video_provider(settings: Settings, offline: bool) -> VideoProvider:
    """Construct the provider that will actually be called.

    Raises:
        ConfigurationError: the real provider is selected without a key.
    """
    if offline:
        from maingott_reel.providers.fake import OfflineVideoProvider
        from maingott_reel.utils.ffmpeg import FFmpeg

        return OfflineVideoProvider(ffmpeg=FFmpeg(settings.ffmpeg_bin))
    from maingott_reel.providers.openai_provider import OpenAIVideoProvider

    return OpenAIVideoProvider(settings)


# --- the stage --------------------------------------------------------------


def generate_assets(
    settings: Settings,
    run_id: str | None = None,
    provider: VideoProvider | None = None,
    offline: bool = False,
    dry_run: bool = False,
    force: bool = False,
    retry_failed: bool = True,
    allow_over_budget: bool = False,
    probe: MediaProbe | None = None,
    cache: AssetCache | None = None,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> AssetsResult:
    """Run the asset generation stage.

    Args:
        settings: effective configuration.
        run_id: run to work in. Defaults to the most recent run.
        provider: video provider to use. Defaults to OpenAI, or the offline
            provider when ``offline`` is set.
        offline: generate placeholder clips instead of calling a video model.
        dry_run: report what would be generated and stop. Nothing is paid for.
        force: regenerate everything, ignoring the cache and previous results.
        retry_failed: retry assets that failed in an earlier run.
        allow_over_budget: generate even when the estimated cost is not
            covered by ``MAX_GENERATION_COST``. Never implicit.
        probe: media inspector. Defaults to ffprobe, or container inspection.
        cache: asset cache. Defaults to the one under the output root.
        source_path: overrides ``settings.source_document`` for staleness checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has no current, valid storyboard.
        ConfigurationError: real generation was requested without credentials.
        BudgetExceededError: the work is not covered by the configured budget.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    board, plan, registry = _load(run)
    check_inputs(settings, run, board, plan, registry, source_path)

    asset_cache = cache or AssetCache(settings.asset_cache_root)
    media_probe = probe or default_probe(settings.ffprobe_bin)

    if provider is not None:
        provider_name, model = provider.name, provider.model
        capabilities = provider.capabilities
    else:
        provider_name, model = video_provider_identity(settings, offline)
        capabilities = video_capabilities(settings, offline)

    asset_plan = plan_assets(
        settings=settings,
        run=run,
        board=board,
        capabilities=capabilities,
        provider_name=provider_name,
        model=model,
        cache=asset_cache,
        retry_failed=retry_failed,
        force=force,
    )

    logger.info(
        "asset plan",
        extra={
            "run_id": run.run_id,
            "provider": provider_name,
            "model": model,
            "assets": len(asset_plan.planned),
            "reused": len(asset_plan.reused),
            "kept_failed": len(asset_plan.kept_failed),
            "cache_hits": len(asset_plan.cache_hits),
            "to_generate": len(asset_plan.to_generate),
            "dry_run": dry_run,
        },
    )
    if dry_run:
        return AssetsResult(run=run, plan=asset_plan, collection=None, dry_run=True)

    # The offline provider costs nothing, so only a real one is budgeted.
    paid = provider_name != FAKE_PROVIDER_NAME
    if paid:
        _check_budget(settings, run, force, allow_over_budget, asset_cache, source_path)

    video_provider = provider or build_video_provider(settings, offline)
    request_log = RequestLog(run.provider_log, run.run_id)
    assets: list[Asset] = []
    for item in asset_plan.planned:
        if item.carried_over and item.previous is not None:
            logger.info(
                "asset carried over from this run",
                extra={"asset": item.previous.id, "status": item.previous.status.value},
            )
            assets.append(item.previous)
            continue
        asset = _generate_one(
            item=item,
            run=run,
            provider=video_provider,
            cache=asset_cache,
            probe=media_probe,
            max_attempts=settings.video_max_attempts,
            use_cache=not force,
            log=request_log,
            paid=paid,
        )
        _record_metadata(run, asset)
        assets.append(asset)

    collection = AssetCollection(
        created_at=datetime.now(tz=UTC),
        source_sha256=registry.source_sha256,
        storyboard_sha256=sha256_file(run.storyboard_json),
        narration_sha256=board.narration_sha256,
        provider=provider_name,
        model=model,
        assets=assets,
    )
    write_model(run.assets_json, collection)
    _record_stage(run, collection, asset_plan)

    logger.info(
        "asset generation complete",
        extra={
            "run_id": run.run_id,
            "ready": len(collection.ready),
            "failed": len(collection.failed),
            "cache_hits": collection.cache_hits,
        },
    )
    return AssetsResult(run=run, plan=asset_plan, collection=collection, dry_run=False)


def _check_budget(
    settings: Settings,
    run: RunContext,
    force: bool,
    allow_over_budget: bool,
    cache: AssetCache,
    source_path: Path | None,
) -> None:
    """Write down what this run would spend, and stop if it is too much.

    Raises:
        BudgetExceededError: the work is not covered by the configured budget.
    """
    from maingott_reel.costing import enforce_budget, plan_generation, write_plan

    plan = plan_generation(
        settings,
        run,
        kinds=(GenerationKind.VIDEO,),
        offline=False,
        force=force,
        cache=cache,
        source_path=source_path,
    )
    plan = plan.model_copy(update={"dry_run": False})
    write_plan(run, plan)
    logger.info(
        "generation budget",
        extra={
            "run_id": run.run_id,
            "planned_calls": plan.planned_calls,
            "cost": plan.cost.summary(),
        },
    )
    enforce_budget(plan, settings, allow_over_budget=allow_over_budget)


def _record_stage(run: RunContext, collection: AssetCollection, plan: AssetPlan) -> None:
    """Write the asset stage's outcome into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.models.video = collection.model
    manifest.files["assets"] = run.assets_json
    manifest.record_stage(
        StageName.GENERATE_ASSETS,
        completed_at=collection.created_at,
        artifact=run.assets_json,
        notes=(
            f"{len(collection.ready)}/{len(collection.assets)} assets ready, "
            f"{collection.cache_hits} from cache, {len(plan.to_generate)} generated, "
            f"{len(collection.failed)} failed, storyboard "
            f"{collection.storyboard_sha256[:12]}"
        ),
    )
    save_manifest(run, manifest)
