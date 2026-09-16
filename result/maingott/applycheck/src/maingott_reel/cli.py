"""Command line interface.

The CLI is a thin shell: it loads settings, configures logging, resolves the
run directory and delegates to a pipeline stage. ``all`` runs the stages in
order and stops at the first one that fails, so the pipeline never reports
success it did not achieve.

Usage:
    python -m maingott_reel.cli --help
    maingott-reel all --duration 40
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from maingott_reel import __version__
from maingott_reel.assets.manager import AssetsResult
from maingott_reel.assets.manager import generate_assets as run_generate_assets
from maingott_reel.audio.audition import AuditionResult
from maingott_reel.audio.audition import audition as run_audition
from maingott_reel.audio.voice import VoiceResult
from maingott_reel.audio.voice import generate_voice as run_generate_voice
from maingott_reel.audit.auditor import AuditResult
from maingott_reel.audit.auditor import audit as run_audit
from maingott_reel.config import Settings, get_settings
from maingott_reel.costing import plan_generation
from maingott_reel.costing import write_plan as write_generation_plan
from maingott_reel.creative.planner import PlanResult
from maingott_reel.creative.planner import plan as run_plan
from maingott_reel.creative.storyboarder import StoryboardResult
from maingott_reel.creative.storyboarder import storyboard as run_storyboard
from maingott_reel.errors import MainGottError
from maingott_reel.logging_config import configure_logging
from maingott_reel.models import (
    ApprovalRecord,
    ApprovalStatus,
    ClaimStatus,
    GenerationKind,
    GenerationPlan,
    Language,
    ReleaseOutcome,
    ReviewChecklist,
)
from maingott_reel.release import approval as approval_store
from maingott_reel.release import package as release_package
from maingott_reel.release import review as review_store
from maingott_reel.release.checker import ReleaseCheckResult
from maingott_reel.release.checker import release_check as run_release_check
from maingott_reel.release.compare import ComparisonReport, compare_runs
from maingott_reel.release.inputs import fingerprint as run_fingerprint
from maingott_reel.release.inputs import load_inputs
from maingott_reel.release.package import ReleasePackage
from maingott_reel.release.reproduce import ReproducibilityReport, check_package, check_run
from maingott_reel.source.analyzer import AnalysisResult
from maingott_reel.source.analyzer import analyze as run_analyze
from maingott_reel.utils.run_context import RunContext
from maingott_reel.video.composition import CompositionResult
from maingott_reel.video.composition import compose as run_compose

EXIT_OK = 0
EXIT_ERROR = 1
#: Reserved for ``release-check``: a valid Reel that must not be released.
EXIT_BLOCKED = 2

console = Console()
app = typer.Typer(help="MainGott AI Reel Generator", no_args_is_help=True, add_completion=False)


@dataclass
class AppContext:
    """State shared by every command."""

    settings: Settings
    run_id: str | None


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"maingott-reel {__version__}", highlight=False)
        raise typer.Exit(EXIT_OK)


@app.callback()
def main(
    ctx: typer.Context,
    run_id: Annotated[
        str | None,
        typer.Option("--run-id", help="Run directory to use. Defaults to the latest run."),
    ] = None,
    log_level: Annotated[
        str | None, typer.Option("--log-level", help="DEBUG, INFO, WARNING, ERROR or CRITICAL.")
    ] = None,
    log_format: Annotated[str | None, typer.Option("--log-format", help="console or json.")] = None,
    _version: Annotated[
        bool,
        typer.Option("--version", callback=_version_callback, is_eager=True, help="Show version."),
    ] = False,
) -> None:
    """Configure settings and logging for the invoked command."""
    try:
        settings = get_settings().model_copy(deep=True)
        if log_level is not None:
            settings.log_level = log_level
        if log_format is not None:
            settings.log_format = log_format  # type: ignore[assignment]
    except Exception as error:
        console.print(f"[red]Configuration error:[/red] {error}")
        raise typer.Exit(EXIT_ERROR) from error

    secrets = [settings.openai_api_key.get_secret_value()] if settings.openai_api_key else []
    configure_logging(level=settings.log_level, fmt=settings.log_format, extra_secrets=secrets)
    ctx.obj = AppContext(settings=settings, run_id=run_id)


def _context(ctx: typer.Context) -> AppContext:
    if not isinstance(ctx.obj, AppContext):  # pragma: no cover - defensive
        raise typer.Exit(EXIT_ERROR)
    return ctx.obj


def _attach_run_log(app_ctx: AppContext, run: RunContext) -> None:
    """Mirror structured logs into the run directory."""
    secrets = (
        [app_ctx.settings.openai_api_key.get_secret_value()]
        if app_ctx.settings.openai_api_key
        else []
    )
    configure_logging(
        level=app_ctx.settings.log_level,
        fmt=app_ctx.settings.log_format,
        log_file=run.log_file,
        extra_secrets=secrets,
    )


def _report_analysis(result: AnalysisResult) -> None:
    """Print a human summary of the analyze stage."""
    registry = result.registry
    table = Table(title=f"analyze — run {result.run.run_id}")
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("source", str(result.source.path))
    table.add_row("source sha256", result.source.sha256)
    table.add_row("blocks", str(result.source.block_count))
    table.add_row(
        "paragraphs / tables", f"{result.source.paragraph_count} / {result.source.table_count}"
    )
    table.add_row("facts", str(result.fact_count))
    table.add_row("target claims", str(len(registry.by_status(ClaimStatus.TARGET))))
    table.add_row(
        "categories", ", ".join(f"{k}={v}" for k, v in registry.category_counts().items())
    )
    table.add_row("facts.json", str(result.run.facts_json))
    table.add_row("reused", "yes" if result.reused else "no")
    console.print(table)


def _report_plan(result: PlanResult) -> None:
    """Print a human summary of the plan stage."""
    plan = result.plan
    table = Table(title=f"plan — run {result.run.run_id}")
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("language", plan.language.value)
    table.add_row("target duration", f"{plan.target_duration_seconds}s")
    table.add_row("planned duration", f"{plan.total_estimated_seconds}s")
    table.add_row("beats", str(plan.beat_count))
    table.add_row("claims", str(len(plan.claims)))
    table.add_row("facts cited", f"{len(plan.source_fact_ids)} of {len(result.selection.facts)}")
    table.add_row("model", f"{plan.provenance.provider}:{plan.provenance.model}")
    table.add_row("prompt version", plan.provenance.prompt_version)
    table.add_row("attempts", str(result.attempts))
    table.add_row("validation", "passed" if plan.passed else "FAILED")
    table.add_row("script.json", str(result.run.script_json))
    table.add_row("reused", "yes" if result.reused else "no")
    console.print(table)

    beats = Table(title="beats")
    beats.add_column("id", style="cyan")
    beats.add_column("kind")
    beats.add_column("s")
    beats.add_column("narration")
    beats.add_column("facts")
    for beat in plan.beats:
        beats.add_row(
            beat.id,
            beat.kind.value,
            f"{beat.estimated_seconds:g}",
            beat.narration,
            ", ".join(beat.source_fact_ids) or "—",
        )
    console.print(beats)


def _report_storyboard(result: StoryboardResult) -> None:
    """Print a human summary of the storyboard stage."""
    board = result.storyboard
    table = Table(title=f"storyboard — run {result.run.run_id}")
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("scenes", str(board.scene_count))
    table.add_row("duration", f"{board.total_duration_seconds}s / {board.target_duration_seconds}s")
    table.add_row("assets required", str(len(board.asset_requirements())))
    table.add_row("facts carried over", str(len(board.source_fact_ids)))
    table.add_row("model", f"{board.provenance.provider}:{board.provenance.model}")
    table.add_row("prompt version", board.provenance.prompt_version)
    table.add_row("attempts", str(result.attempts))
    table.add_row("validation", "passed" if board.passed else "FAILED")
    table.add_row("storyboard.json", str(result.run.storyboard_json))
    table.add_row("reused", "yes" if result.reused else "no")
    console.print(table)

    scenes = Table(title="scenes")
    scenes.add_column("id", style="cyan")
    scenes.add_column("beat")
    scenes.add_column("start")
    scenes.add_column("s")
    scenes.add_column("overlay")
    scenes.add_column("visual")
    for scene in board.scenes:
        scenes.add_row(
            scene.id,
            scene.beat_id,
            f"{scene.start_seconds:g}",
            f"{scene.duration_seconds:g}",
            scene.overlay_text or "—",
            scene.visual_description,
        )
    console.print(scenes)


def _report_assets(result: AssetsResult) -> None:
    """Print the generation plan and, when it ran, what came of it."""
    plan = result.plan
    table = Table(
        title=f"generate-assets — run {result.run.run_id}"
        + (" (dry run)" if result.dry_run else "")
    )
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("provider", f"{plan.provider}:{plan.model}")
    table.add_row(
        "supported clip lengths", ", ".join(f"{s}s" for s in plan.capabilities.supported_seconds)
    )
    table.add_row("declared assets", str(len(plan.planned)))
    table.add_row("already in this run", str(len(plan.reused)))
    table.add_row("cache hits", str(len(plan.cache_hits)))
    table.add_row("to generate", str(len(plan.to_generate)))
    if result.collection is not None:
        table.add_row("ready", str(len(result.collection.ready)))
        table.add_row("failed", str(len(result.collection.failed)))
        table.add_row("assets.json", str(result.run.assets_json))
    console.print(table)

    scenes = Table(title="assets")
    scenes.add_column("scene", style="cyan")
    scenes.add_column("asset id")
    scenes.add_column("scene s")
    scenes.add_column("clip s")
    scenes.add_column("size")
    scenes.add_column("duration")
    scenes.add_column("action" if result.dry_run else "status")
    for item in plan.planned:
        request = item.request
        if result.dry_run:
            if item.reused:
                outcome = "reuse"
            elif item.kept_failed:
                outcome = "keep failed"
            elif item.cached:
                outcome = "cache"
            else:
                outcome = "GENERATE"
        else:
            asset = result.collection.for_scene(request.scene_id) if result.collection else None
            outcome = asset.status.value if asset else "unknown"
        scenes.add_row(
            request.scene_id,
            request.asset_id,
            f"{request.requested_duration_seconds:g}",
            f"{request.generated_seconds}",
            f"{request.width}x{request.height}",
            request.duration_strategy.value,
            outcome,
        )
    console.print(scenes)

    if result.dry_run:
        console.print(
            f"[yellow]Dry run: nothing was generated. "
            f"{len(plan.to_generate)} clip(s) would be generated with "
            f"{plan.provider}:{plan.model}.[/yellow]"
        )
    for asset in result.failed:
        console.print(f"[red]{asset.scene_id}: {asset.error}[/red]")


def _report_voice(result: VoiceResult) -> None:
    """Print the narration plan and, when it ran, what came of it."""
    plan = result.plan
    request = plan.request
    asset = result.asset
    table = Table(
        title=f"generate-voice — run {result.run.run_id}" + (" (dry run)" if result.dry_run else "")
    )
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("provider", f"{request.provider}:{request.model}")
    table.add_row("voice", f"{request.voice} ({request.language.value})")
    table.add_row("format", request.audio_format.value)
    table.add_row("speaking speed", f"{request.speed:g}" if request.speed else "default")
    table.add_row("voice direction", "applied" if request.instructions else "— none —")
    table.add_row("narration sha256", request.narration_sha256[:16])
    table.add_row("narration", f"{request.characters} characters, {request.words} words")
    table.add_row("timeline", f"{request.target_duration_seconds}s")
    table.add_row("cache", plan.cache_state)
    table.add_row("generation calls", str(plan.generation_count))
    if plan.takes:
        table.add_row("takes", f"{len(plan.takes)} scene(s)")
    if result.dry_run:
        table.add_row("estimated speech", f"~{plan.estimated_seconds:g}s")
    if asset is not None:
        table.add_row("status", asset.status.value)
        if asset.metrics is not None:
            metrics = asset.metrics
            table.add_row("measured speech", f"{metrics.duration_seconds:g}s")
            table.add_row(
                "speech rate",
                f"{metrics.characters_per_second:g} cps / {metrics.words_per_minute:g} wpm",
            )
            table.add_row("headroom", f"{metrics.headroom_seconds:+g}s")
        if asset.sample_rate:
            table.add_row("audio", f"{asset.sample_rate} Hz, {asset.channels} ch, {asset.codec}")
        table.add_row("voice.json", str(result.run.voice_json))
        if asset.path is not None:
            table.add_row("output", str(asset.path))
        table.add_row("validation", "passed" if asset.passed else "FAILED")
    console.print(table)

    if result.dry_run and plan.takes:
        # A dry run is where somebody decides whether to pay, so show what
        # would be spoken rather than only how many calls it comes to.
        planned = Table(title="takes that would be spoken")
        planned.add_column("scene", style="cyan")
        planned.add_column("starts at")
        planned.add_column("scene runs")
        planned.add_column("narration")
        for slot in plan.takes:
            planned.add_row(
                slot.scene_id,
                f"{slot.start_seconds:g}s",
                f"{slot.scene_seconds:g}s",
                f"{slot.request.characters} characters",
            )
        console.print(planned)

    if asset is not None and asset.takes:
        takes = Table(title="takes")
        takes.add_column("scene", style="cyan")
        takes.add_column("starts at")
        takes.add_column("spoken")
        takes.add_column("scene")
        takes.add_column("speed")
        takes.add_column("source")
        for take in asset.takes:
            takes.add_row(
                take.scene_id,
                f"{take.start_seconds:g}s",
                f"{take.duration_seconds:g}s",
                f"{take.scene_seconds:g}s",
                f"{take.speed:g}" if take.speed else "default",
                "cache" if take.cache_hit else "generated",
            )
        console.print(takes)

    if asset is not None:
        for change in asset.transformations:
            console.print(f"[yellow]{change}[/yellow]")
        if asset.validation is not None:
            for check in asset.validation.failures:
                console.print(f"[red]{check.name}: {check.detail}[/red]")
        if asset.error:
            console.print(f"[red]{asset.error}[/red]")
    if result.dry_run:
        console.print(
            f"[yellow]Dry run: nothing was generated. {plan.generation_count} call(s) would be "
            f"made to {request.provider}:{request.model}.[/yellow]"
        )
    if result.development:
        console.print(
            "[yellow]Development narration: this is a placeholder track, not a voice. "
            "It must not be published.[/yellow]"
        )


def _report_audition(result: AuditionResult) -> None:
    """Print the candidates and what a human has to do next."""
    recorded = result.audition
    plan = result.plan
    table = Table(
        title=f"voice-audition — run {recorded.run_id}" + (" (dry run)" if result.dry_run else "")
    )
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("candidates", str(plan.planned_calls))
    table.add_row("sample", f"{len(recorded.sample_text)} characters of approved narration")
    table.add_row("sample sha256", recorded.sample_sha256[:16])
    table.add_row("cost", plan.cost.summary())
    if not result.dry_run:
        table.add_row("directory", str(result.directory))
    console.print(table)
    console.print(recorded.sample_text)

    if result.dry_run:
        console.print(
            "[yellow]Dry run: nothing was generated. "
            f"{plan.planned_calls} sample(s) would be recorded.[/yellow]"
        )
        return

    samples = Table(title="candidates")
    samples.add_column("voice", style="cyan")
    samples.add_column("model")
    samples.add_column("duration")
    samples.add_column("audio")
    samples.add_column("file")
    for sample in recorded.samples:
        if sample.usable:
            samples.add_row(
                sample.voice,
                f"{sample.provider}:{sample.model}",
                f"{sample.duration_seconds:g}s",
                f"{sample.sample_rate} Hz {sample.codec}",
                str(sample.path),
            )
        else:
            samples.add_row(sample.voice, f"{sample.provider}:{sample.model}", "—", "—", "")
    console.print(samples)

    for sample in recorded.failed:
        console.print(f"[red]{sample.voice}: {sample.error}[/red]")
    console.print(recorded.summary())
    console.print(
        "[yellow]Listen to these, then record your choice by hand in "
        "input/brand/voice_profile.json (provider, model, voice, language, "
        "approved: true, approved_by). Nothing here may choose or approve a voice."
        "[/yellow]"
    )


def _report_composition(result: CompositionResult) -> None:
    """Print the composition plan and, when it ran, what came of it."""
    composition = result.composition
    settings = composition.settings
    table = Table(
        title=f"compose — run {result.run.run_id}" + (" (dry run)" if result.dry_run else "")
    )
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("resolution", f"{settings.width}x{settings.height}")
    table.add_row("frame rate", f"{settings.fps} fps")
    table.add_row("duration", f"{composition.timeline_duration_seconds}s")
    table.add_row("scenes", str(composition.scene_count))
    table.add_row("captions", str(len(composition.captions)))
    table.add_row("codecs", f"{settings.video_codec} / {settings.audio_codec}")
    table.add_row("font", composition.font.family)
    table.add_row("logo", str(composition.logo.path) if composition.logo else "— none —")
    table.add_row(
        "narration",
        "silent (development)" if composition.audio.silent else str(composition.audio.voice_path),
    )
    table.add_row(
        "music", str(composition.audio.music_path) if composition.audio.has_music else "— none —"
    )
    table.add_row("composition id", composition.composition_sha256[:16])
    if not result.dry_run:
        table.add_row("output", str(composition.output_path))
        table.add_row("size", f"{(composition.output_size_bytes or 0) / 1_000_000:.1f} MB")
        table.add_row("validation", "passed" if composition.passed else "FAILED")
        table.add_row("reused", "yes" if result.reused else "no")
    console.print(table)

    scenes = Table(title="timeline")
    scenes.add_column("scene", style="cyan")
    scenes.add_column("start")
    scenes.add_column("s")
    scenes.add_column("clip")
    scenes.add_column("trim")
    scenes.add_column("geometry")
    scenes.add_column("transition")
    for scene in composition.scenes:
        geometry = scene.geometry
        scenes.add_row(
            scene.scene_id,
            f"{scene.start_seconds:g}",
            f"{scene.duration_seconds:g}",
            f"{scene.source_duration_seconds:g}s",
            f"{scene.trim_duration_seconds:g}s",
            f"{geometry.source_width}x{geometry.source_height} → "
            f"{geometry.output_width}x{geometry.output_height}"
            + (" (upscale)" if geometry.is_upscale else ""),
            scene.transition.value
            + (f" {scene.transition_seconds:g}s" if scene.transition_seconds else ""),
        )
    console.print(scenes)

    if composition.validation is not None:
        for check in composition.validation.failures:
            console.print(f"[red]{check.name}: {check.detail}[/red]")
    if composition.readiness is not None:
        for check in composition.readiness.failures:
            console.print(f"[yellow]not production ready — {check.name}: {check.detail}[/yellow]")
    if result.development:
        console.print(
            "[yellow]Development output: this Reel is missing production narration or "
            "branding and must not be published.[/yellow]"
        )
    if result.dry_run:
        console.print("[yellow]Dry run: nothing was encoded.[/yellow]")


def _report_audit(result: AuditResult) -> None:
    """Print the quality gates, grouped, with the verdict."""
    from maingott_reel.models import GateGroup

    report = result.report
    table = Table(title=f"validate — run {result.run.run_id}")
    table.add_column("gate", style="cyan")
    table.add_column("group")
    table.add_column("result")
    table.add_column("detail")
    for group in GateGroup:
        for gate in report.by_group(group):
            if gate.passed:
                outcome = "[green]pass[/green]"
            elif gate.severity.value == "warning":
                outcome = "[yellow]warn[/yellow]"
            else:
                outcome = "[red]FAIL[/red]"
            table.add_row(gate.name, group.value, outcome, gate.detail or "")
    console.print(table)

    console.print(report.summary())
    if report.passed:
        console.print("[green]The Reel satisfies every blocking quality gate.[/green]")
    else:
        console.print("[red]The Reel does not satisfy the quality gates.[/red]")
    if not report.production_ready:
        console.print(
            "[yellow]Not production ready: "
            + "; ".join(f"{gate.name} ({gate.detail})" for gate in report.warnings)
            + "[/yellow]"
        )


def _resolve(app_ctx: AppContext) -> RunContext:
    """Resolve the run a command works on, and mirror logs into it."""
    from maingott_reel.utils.run_context import resolve_run

    run = resolve_run(app_ctx.settings, app_ctx.run_id)
    _attach_run_log(app_ctx, run)
    return run


def _report_review(checklist: ReviewChecklist, restarted: bool, path: Path) -> None:
    """Print the automated verdict and what a human still has to say."""
    table = Table(title=f"review — run {checklist.run_id}")
    table.add_column("", style="cyan")
    table.add_column("item")
    table.add_column("question")
    table.add_column("confirmed by")
    for item in checklist.items:
        mark = "[green][x][/green]" if item.confirmed else "[ ]"
        table.add_row(mark, item.id, item.question, item.confirmed_by or "")
    console.print(table)
    console.print(f"Reel under review: {checklist.final_sha256[:16]}")
    console.print(checklist.summary())
    console.print(f"review.json: {path}")
    if restarted:
        console.print(
            "[yellow]The Reel changed since it was last reviewed, so the review started "
            "again.[/yellow]"
        )
    if checklist.complete:
        console.print("[green]Human review complete. 'approve --by NAME' is now possible.[/green]")
    else:
        console.print(
            "Confirm items with: maingott-reel review --confirm ITEM --by NAME (or --confirm all)"
        )


def _report_approval(record: ApprovalRecord, path: Path) -> None:
    """Print a recorded decision."""
    table = Table(title=f"approve — run {record.run_id}")
    table.add_column("field", style="cyan")
    table.add_column("value")
    table.add_row("status", record.status.value)
    table.add_row("release version", record.release_version)
    table.add_row("by", record.approved_by)
    table.add_row("at", record.approved_at.isoformat())
    table.add_row("final file", record.final_sha256[:16])
    table.add_row("release id", record.fingerprint.release_id)
    table.add_row("notes", record.notes or "—")
    console.print(table)
    console.print(f"approval.json: {path}")
    if record.approves:
        console.print(
            "[green]Approved. Run 'release' to write the immutable release package.[/green]"
        )
        console.print(
            "[yellow]If the Reel is recomposed, this approval no longer applies.[/yellow]"
        )
    else:
        console.print("[yellow]Recorded as rejected. No release can be built from it.[/yellow]")


def _report_release(package: ReleasePackage) -> None:
    """Print a written release package."""
    manifest = package.manifest
    table = Table(title=f"release — {manifest.release_id}")
    table.add_column("field", style="cyan")
    table.add_column("value")
    table.add_row("release version", manifest.release_version)
    table.add_row("run", manifest.run_id)
    table.add_row("approved by", f"{manifest.approved_by} at {manifest.approved_at.isoformat()}")
    table.add_row("final file", manifest.fingerprint.final_sha256[:16])
    table.add_row("duration", f"{manifest.duration_seconds:g}s")
    table.add_row("resolution", f"{manifest.width}x{manifest.height}")
    table.add_row("files", str(len(manifest.files)))
    table.add_row("package", str(package.root))
    console.print(table)

    files = Table(title="package contents")
    files.add_column("name", style="cyan")
    files.add_column("path")
    files.add_column("sha256")
    for entry in manifest.files:
        files.add_row(entry.name, entry.path, entry.sha256[:16])
    console.print(files)
    console.print(
        "[green]Immutable release package written. Publishing is not part of this pipeline.[/green]"
    )


def _report_generation_plan(plan: GenerationPlan, settings: Settings) -> None:
    """Print what a paid run would do and what it would cost."""
    cost = plan.cost
    table = Table(title=f"cost-estimate — run {plan.run_id}")
    table.add_column("metric", style="cyan")
    table.add_column("value")
    table.add_row("planned calls", str(plan.planned_calls))
    table.add_row("already available", str(plan.cache_hits))
    for line in cost.lines:
        if line.cost_usd is None:
            amount = "COST UNKNOWN"
        else:
            ceiling = "at most " if line.upper_bound else ""
            amount = f"{ceiling}{line.cost_usd:.4f} {cost.currency}"
        table.add_row(
            f"{line.kind.value} ({line.provider}:{line.model})",
            f"{line.calls} call(s), {line.units:g} {line.unit}, "
            f"{line.price_label} {cost.currency} → {amount}",
        )
    total = cost.total_usd
    table.add_row(
        "total",
        f"{'at most ' if cost.is_upper_bound else ''}{total:.2f} {cost.currency}"
        if total is not None
        else "COST UNKNOWN",
    )
    table.add_row(
        "budget",
        f"{cost.budget_usd:.2f} {cost.currency}"
        if cost.budget_usd is not None
        else "— none configured —",
    )
    table.add_row("pricing", str(cost.pricing_path) if cost.pricing_path else "— none —")
    table.add_row("pricing source", cost.pricing_source or "—")
    table.add_row("configuration", plan.configuration_sha256[:16])
    console.print(table)

    items = Table(title="planned generation")
    items.add_column("kind", style="cyan")
    items.add_column("identity")
    items.add_column("request")
    items.add_column("action")
    for item in plan.items:
        if item.kind is GenerationKind.VIDEO:
            request = f"{item.seconds:g}s at {item.width}x{item.height}"
        else:
            request = f"{item.characters} characters"
        items.add_row(
            item.kind.value,
            item.identity,
            request,
            "GENERATE" if item.needs_generation else item.cache_state,
        )
    console.print(items)

    console.print(cost.summary())
    if not cost.known and cost.calls:
        console.print(
            "[yellow]COST UNKNOWN: no verified price is configured for every model in this "
            f"plan. Fill in {settings.pricing_path} with prices you have checked against the "
            "provider's current price list.[/yellow]"
        )
    within = cost.within_budget
    if within is False:
        console.print(
            "[red]This plan is over the configured budget. Generation will refuse to start "
            "without --allow-over-budget.[/red]"
        )
    console.print("[yellow]Nothing was generated: this command only inspects.[/yellow]")


def _report_release_check(result: ReleaseCheckResult) -> None:
    """Print the release gates and the verdict."""
    table = Table(title=f"release-check — run {result.run.run_id}")
    table.add_column("gate", style="cyan")
    table.add_column("result")
    table.add_column("detail")
    for gate in result.report.gates:
        if gate.passed:
            outcome = "[green]pass[/green]"
        elif gate.severity.value == "warning":
            outcome = "[yellow]warn[/yellow]"
        else:
            outcome = "[red]BLOCK[/red]"
        table.add_row(gate.name, outcome, gate.detail or "")
    console.print(table)

    console.print(f"quality audit: {result.audit.summary()}")
    console.print(result.summary())
    console.print(f"release id if approved: {result.fingerprint.release_id}")
    if result.outcome is ReleaseOutcome.PASS:
        console.print(
            "[green]RELEASE CANDIDATE: run 'review', confirm every item, then "
            "'approve --by NAME'.[/green]"
        )
    elif result.outcome is ReleaseOutcome.BLOCKED:
        console.print("[yellow]BLOCKED: this Reel must not be released.[/yellow]")
        for gate in result.blocking:
            console.print(f"[yellow]  {gate.name}: {gate.detail}[/yellow]")
    else:
        console.print("[red]FAIL: the Reel does not pass its own quality gates.[/red]")
        for gate in result.audit.blocking_failures:
            console.print(f"[red]  {gate.name}: {gate.detail}[/red]")


def _report_comparison(report: ComparisonReport) -> None:
    """Print two runs side by side."""
    table = Table(title=f"compare — {report.left_run_id} vs {report.right_run_id}")
    table.add_column("aspect", style="cyan")
    table.add_column(report.left_run_id)
    table.add_column(report.right_run_id)
    table.add_column("")
    for item in report.differences:
        marker = "[red]changed[/red]" if item.changed else ""
        table.add_row(item.aspect, item.left, item.right, marker)
    console.print(table)
    console.print(report.summary())


def _report_reproducibility(report: ReproducibilityReport) -> None:
    """Print what is and is not recoverable."""
    table = Table(title=f"reproduce-check — {report.subject}")
    table.add_column("input", style="cyan")
    table.add_column("available")
    table.add_column("detail")
    for item in report.items:
        if item.available:
            state = "[green]yes[/green]"
        else:
            state = "[red]NO[/red]" if item.required else "[yellow]no[/yellow]"
        table.add_row(item.name, state, item.detail)
    console.print(table)
    console.print(report.summary())
    if report.reproducible:
        console.print("[green]Every input needed to explain this Reel is recorded.[/green]")
    else:
        console.print("[red]Missing: " + ", ".join(item.name for item in report.missing) + "[/red]")


@app.command()
def analyze(
    ctx: typer.Context,
    source: Annotated[
        Path | None,
        typer.Option("--source", help="Specification to analyse. Defaults to SOURCE_DOCUMENT."),
    ] = None,
    force: Annotated[
        bool, typer.Option("--force", help="Re-extract even if this run already analysed it.")
    ] = False,
) -> None:
    """Extract text and business facts from the MainGott specification."""
    app_ctx = _context(ctx)
    try:
        result = run_analyze(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            source_path=source,
            force=force,
            on_run_created=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_analysis(result)


@app.command()
def plan(
    ctx: typer.Context,
    duration: Annotated[
        int | None, typer.Option("--duration", help="Target Reel duration in seconds.")
    ] = None,
    language: Annotated[
        Language | None, typer.Option("--language", help="Narration language.")
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Plan offline with the built-in fake planner."),
    ] = False,
    allow_target_facts: Annotated[
        bool,
        typer.Option(
            "--allow-target-facts",
            help="Offer design-target facts. They may only be used as targets.",
        ),
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Replan even if this run already holds a plan.")
    ] = False,
) -> None:
    """Produce the creative brief and script plan from the analysed facts."""
    app_ctx = _context(ctx)
    try:
        result = run_plan(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            duration=duration,
            language=language,
            allow_target_facts=allow_target_facts or None,
            dry_run=dry_run,
            force=force,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_plan(result)


@app.command()
def storyboard(
    ctx: typer.Context,
    duration: Annotated[
        int | None,
        typer.Option("--duration", help="Target duration. Defaults to the plan's target."),
    ] = None,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Build shots offline with the built-in provider.")
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Rebuild even if this run already has a storyboard.")
    ] = False,
) -> None:
    """Turn the script plan into timed scenes with asset requirements."""
    app_ctx = _context(ctx)
    try:
        result = run_storyboard(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            duration=duration,
            dry_run=dry_run,
            force=force,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_storyboard(result)


@app.command("generate-assets")
def generate_assets(
    ctx: typer.Context,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Show what would be generated. Generates nothing."),
    ] = False,
    offline: Annotated[
        bool,
        typer.Option("--offline", help="Write placeholder clips instead of calling the model."),
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Regenerate everything, ignoring cache and results.")
    ] = False,
    keep_failed: Annotated[
        bool, typer.Option("--keep-failed", help="Do not retry assets that failed earlier.")
    ] = False,
    allow_over_budget: Annotated[
        bool,
        typer.Option(
            "--allow-over-budget",
            help="Generate even when the cost is over MAX_GENERATION_COST or unknown.",
        ),
    ] = False,
) -> None:
    """Generate the footage every storyboard scene declares."""
    app_ctx = _context(ctx)
    try:
        result = run_generate_assets(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            offline=offline,
            dry_run=dry_run,
            force=force,
            retry_failed=not keep_failed,
            allow_over_budget=allow_over_budget,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_assets(result)
    if not result.dry_run and not result.complete:
        console.print(
            f"[red]{len(result.failed)} of {len(result.plan.planned)} assets failed.[/red]"
        )
        raise typer.Exit(EXIT_ERROR)


@app.command("generate-voice")
def generate_voice(
    ctx: typer.Context,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Show what would be generated. Generates nothing."),
    ] = False,
    offline: Annotated[
        bool,
        typer.Option("--offline", help="Write a placeholder track instead of calling a model."),
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Regenerate, ignoring the cache and any earlier take.")
    ] = False,
    allow_over_budget: Annotated[
        bool,
        typer.Option(
            "--allow-over-budget",
            help="Generate even when the cost is over MAX_GENERATION_COST or unknown.",
        ),
    ] = False,
) -> None:
    """Speak the approved narration."""
    app_ctx = _context(ctx)
    try:
        result = run_generate_voice(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            offline=offline,
            dry_run=dry_run,
            force=force,
            allow_over_budget=allow_over_budget,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_voice(result)
    if not result.dry_run and not result.complete:
        console.print("[red]The narration could not be generated.[/red]")
        raise typer.Exit(EXIT_ERROR)


@app.command("voice-audition")
def voice_audition(
    ctx: typer.Context,
    voice: Annotated[
        list[str] | None,
        typer.Option("--voice", help="Candidate voice to audition. Repeatable."),
    ] = None,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Show what would be recorded. Records nothing.")
    ] = False,
    offline: Annotated[
        bool, typer.Option("--offline", help="Use the placeholder provider (no API calls).")
    ] = False,
    allow_over_budget: Annotated[
        bool,
        typer.Option(
            "--allow-over-budget",
            help="Audition even when the cost is over MAX_GENERATION_COST or unknown.",
        ),
    ] = False,
) -> None:
    """Record candidate voices reading the approved narration, for a human to judge."""
    app_ctx = _context(ctx)
    try:
        result = run_audition(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            voices=list(voice) if voice else None,
            offline=offline,
            dry_run=dry_run,
            allow_over_budget=allow_over_budget,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_audition(result)
    if not result.dry_run and not result.complete:
        raise typer.Exit(EXIT_ERROR)


@app.command()
def compose(
    ctx: typer.Context,
    voice: Annotated[
        Path | None, typer.Option("--voice", help="Approved narration track to mix in.")
    ] = None,
    music: Annotated[
        Path | None, typer.Option("--music", help="Music bed. Defaults to input/brand/music.")
    ] = None,
    no_logo: Annotated[
        bool, typer.Option("--no-logo", help="Compose without a brand mark (development).")
    ] = False,
    silent_voice: Annotated[
        bool, typer.Option("--silent-voice", help="Compose with silent audio (development).")
    ] = False,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Plan the composition. Encodes nothing.")
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Recompose even if this run already holds a Reel.")
    ] = False,
) -> None:
    """Assemble the final Reel with FFmpeg."""
    app_ctx = _context(ctx)
    try:
        result = run_compose(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            voice=voice,
            music=music,
            no_logo=no_logo,
            silent_voice=silent_voice,
            dry_run=dry_run,
            force=force,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_composition(result)
    if not result.dry_run and not result.passed:
        console.print("[red]The composed Reel did not pass validation.[/red]")
        raise typer.Exit(EXIT_ERROR)


@app.command()
def validate(
    ctx: typer.Context,
    strict: Annotated[
        bool,
        typer.Option("--strict", help="Fail on advisory warnings too, not just blocking gates."),
    ] = False,
) -> None:
    """Run the quality gates against a finished run."""
    app_ctx = _context(ctx)
    try:
        result = run_audit(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            strict=strict,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_audit(result)
    if not result.passed:
        raise typer.Exit(EXIT_ERROR)


@app.command("all")
def run_all(
    ctx: typer.Context,
    duration: Annotated[
        int | None, typer.Option("--duration", help="Target Reel duration in seconds.")
    ] = None,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Inspect every stage. Nothing is paid for.")
    ] = False,
    offline: Annotated[
        bool,
        typer.Option(
            "--offline",
            help="Run end to end with the offline providers. Produces a development Reel.",
        ),
    ] = False,
    music: Annotated[
        Path | None, typer.Option("--music", help="Music bed. Defaults to input/brand/music.")
    ] = None,
    no_logo: Annotated[
        bool, typer.Option("--no-logo", help="Compose without a brand mark (development).")
    ] = False,
    allow_over_budget: Annotated[
        bool,
        typer.Option(
            "--allow-over-budget",
            help="Generate even when the cost is over MAX_GENERATION_COST or unknown.",
        ),
    ] = False,
) -> None:
    """Run the full pipeline end to end.

    Stages run in order — analyze, plan, storyboard, generate-assets,
    generate-voice, compose, validate — and the first failure stops the run,
    so the pipeline never reports success it did not achieve.
    """
    app_ctx = _context(ctx)
    settings = app_ctx.settings
    # Planning and storyboarding call a text model; --offline uses the built-in
    # providers for those exactly as --dry-run does.
    offline_text = dry_run or offline
    try:
        settings.resolve_duration(duration)
        analysis = run_analyze(
            settings,
            run_id=app_ctx.run_id,
            on_run_created=lambda run: _attach_run_log(app_ctx, run),
        )
        _report_analysis(analysis)
        run = analysis.run

        planned = run_plan(settings, run_id=run.run_id, duration=duration, dry_run=offline_text)
        _report_plan(planned)

        boarded = run_storyboard(
            settings, run_id=run.run_id, duration=duration, dry_run=offline_text
        )
        _report_storyboard(boarded)

        # A dry run plans the generation but never pays for it.
        generated = run_generate_assets(
            settings,
            run_id=run.run_id,
            offline=offline,
            dry_run=dry_run,
            allow_over_budget=allow_over_budget,
        )
        _report_assets(generated)
        if not generated.dry_run and not generated.complete:
            console.print(f"[red]{len(generated.failed)} assets failed.[/red]")
            raise typer.Exit(EXIT_ERROR)

        spoken = run_generate_voice(
            settings,
            run_id=run.run_id,
            offline=offline,
            dry_run=dry_run,
            allow_over_budget=allow_over_budget,
        )
        _report_voice(spoken)
        if not spoken.dry_run and not spoken.complete:
            console.print("[red]The narration could not be generated.[/red]")
            raise typer.Exit(EXIT_ERROR)

        # A dry run generates nothing, so on a run that has never generated
        # anything there is nothing for the last two stages to inspect. That
        # is said plainly rather than reported as success.
        if dry_run and not run.assets_json.is_file():
            console.print(
                "[yellow]compose: skipped — a dry run generates no footage to compose.[/yellow]"
            )
            console.print(
                "[yellow]validate: skipped — a dry run composes nothing to audit.[/yellow]"
            )
            return

        composed = run_compose(
            settings,
            run_id=run.run_id,
            music=music,
            # Offline is a development mode by definition: an approved brand
            # mark is used when there is one, and its absence is not fatal.
            no_logo=no_logo or offline,
            dry_run=dry_run,
        )
        _report_composition(composed)
        if not composed.dry_run and not composed.passed:
            console.print("[red]The composed Reel did not pass validation.[/red]")
            raise typer.Exit(EXIT_ERROR)

        if not run.composition_json.is_file():
            console.print(
                "[yellow]validate: skipped — a dry run composes nothing to audit.[/yellow]"
            )
            return

        audited = run_audit(settings, run_id=run.run_id)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_audit(audited)
    if not audited.passed:
        raise typer.Exit(EXIT_ERROR)


# --- cost control -----------------------------------------------------------


@app.command("cost-estimate")
def cost_estimate(
    ctx: typer.Context,
    offline: Annotated[
        bool, typer.Option("--offline", help="Estimate the offline providers instead.")
    ] = False,
    force: Annotated[
        bool, typer.Option("--force", help="Estimate as if nothing were cached.")
    ] = False,
) -> None:
    """Report what generating this run would cost. Generates nothing."""
    app_ctx = _context(ctx)
    try:
        run = _resolve(app_ctx)
        plan = plan_generation(app_ctx.settings, run, offline=offline, force=force)
        write_generation_plan(run, plan)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_generation_plan(plan, app_ctx.settings)
    console.print(f"generation_plan.json: {run.generation_plan_json}")


# --- release ----------------------------------------------------------------


@app.command("release-check")
def release_check(ctx: typer.Context) -> None:
    """Ask whether this exact Reel may be released.

    Exit codes: 0 a release candidate, 1 the quality gates failed, 2 valid but
    blocked from release.
    """
    app_ctx = _context(ctx)
    try:
        result = run_release_check(
            app_ctx.settings,
            run_id=app_ctx.run_id,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_release_check(result)
    if result.outcome is ReleaseOutcome.FAIL:
        raise typer.Exit(EXIT_ERROR)
    if result.outcome is ReleaseOutcome.BLOCKED:
        raise typer.Exit(EXIT_BLOCKED)


@app.command()
def review(
    ctx: typer.Context,
    confirm: Annotated[
        list[str] | None,
        typer.Option(
            "--confirm",
            help="Confirm one review item by id. Repeatable. Use 'all' for every item.",
        ),
    ] = None,
    by: Annotated[
        str | None, typer.Option("--by", help="Who is confirming. Required with --confirm.")
    ] = None,
    note: Annotated[str | None, typer.Option("--note", help="A note to record.")] = None,
) -> None:
    """Show the human review checklist, and record confirmations."""
    app_ctx = _context(ctx)
    try:
        run = _resolve(app_ctx)
        inputs = load_inputs(run)
        identity = run_fingerprint(app_ctx.settings, inputs)
        checklist, restarted = review_store.current_checklist(run, identity.final_sha256)
        if confirm:
            if by is None:
                raise MainGottError("--confirm needs --by NAME: a review is somebody's judgement")
            wanted = review_store.item_ids() if "all" in confirm else confirm
            checklist = review_store.confirm(checklist, wanted, reviewer=by, note=note)
        review_store.save_checklist(run, checklist)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_review(checklist, restarted, run.review_json)


@app.command()
def approve(
    ctx: typer.Context,
    by: Annotated[str, typer.Option("--by", help="Who is approving this Reel.")],
    version: Annotated[
        str | None, typer.Option("--version", help="Release version, e.g. v1.0.0.")
    ] = None,
    note: Annotated[str | None, typer.Option("--note", help="A note to record.")] = None,
    reject: Annotated[
        bool, typer.Option("--reject", help="Record a rejection instead of an approval.")
    ] = False,
) -> None:
    """Record a human decision about this exact Reel."""
    app_ctx = _context(ctx)
    settings = app_ctx.settings
    try:
        result = run_release_check(
            settings,
            run_id=app_ctx.run_id,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
        status = ApprovalStatus.REJECTED if reject else ApprovalStatus.APPROVED
        if status is ApprovalStatus.APPROVED and not result.is_release_candidate:
            _report_release_check(result)
            console.print(
                "[red]This run is not a release candidate, so it cannot be approved.[/red]"
            )
            raise typer.Exit(EXIT_ERROR if result.outcome is ReleaseOutcome.FAIL else EXIT_BLOCKED)
        record = approval_store.create(
            run=result.run,
            fingerprint=result.fingerprint,
            approved_by=by,
            release_version=version or settings.release_version,
            review=result.review,
            notes=note,
            status=status,
        )
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_approval(record, result.run.approval_json)


@app.command("release")
def create_release(ctx: typer.Context) -> None:
    """Write the immutable release package for an approved Reel."""
    app_ctx = _context(ctx)
    settings = app_ctx.settings
    try:
        result = run_release_check(
            settings,
            run_id=app_ctx.run_id,
            on_run_resolved=lambda run: _attach_run_log(app_ctx, run),
        )
        if not result.is_release_candidate:
            _report_release_check(result)
            console.print("[red]This run is not a release candidate.[/red]")
            raise typer.Exit(EXIT_ERROR if result.outcome is ReleaseOutcome.FAIL else EXIT_BLOCKED)
        approval = approval_store.require_valid(result.approval, result.fingerprint)
        package = release_package.build(settings, result.inputs, result.fingerprint, approval)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_release(package)


@app.command("release-validate")
def release_validate(
    ctx: typer.Context,
    release_id: Annotated[
        str | None,
        typer.Option("--release-id", help="Release to validate. Defaults to the newest."),
    ] = None,
) -> None:
    """Check that a release package is still exactly what was released."""
    app_ctx = _context(ctx)
    settings = app_ctx.settings
    try:
        identifier = release_id or release_package.latest(settings)
        if identifier is None:
            raise MainGottError(f"No release package exists under {settings.releases_root}.")
        package = release_package.load(settings, identifier)
        result = release_package.validate(package)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error

    table = Table(title=f"release-validate — {package.release_id}")
    table.add_column("check", style="cyan")
    table.add_column("result")
    table.add_column("detail")
    for name, passed, detail in result.checks:
        table.add_row(name, "[green]pass[/green]" if passed else "[red]FAIL[/red]", detail)
    console.print(table)
    console.print(result.summary())
    if result.passed:
        console.print(f"[green]{package.release_id} is intact.[/green]")
    else:
        console.print("[red]The release package has changed since it was written.[/red]")
        raise typer.Exit(EXIT_ERROR)


@app.command()
def compare(
    ctx: typer.Context,
    run_a: Annotated[str, typer.Argument(help="The earlier run id.")],
    run_b: Annotated[str, typer.Argument(help="The later run id.")],
) -> None:
    """Compare the production artifacts of two runs."""
    app_ctx = _context(ctx)
    try:
        report = compare_runs(app_ctx.settings, run_a, run_b)
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_comparison(report)


@app.command("reproduce-check")
def reproduce_check(
    ctx: typer.Context,
    release_id: Annotated[
        str | None,
        typer.Option("--release-id", help="Audit a release package instead of a run."),
    ] = None,
) -> None:
    """Check that enough is recorded to explain how a Reel was made."""
    app_ctx = _context(ctx)
    settings = app_ctx.settings
    try:
        if release_id is not None:
            package = release_package.load(settings, release_id)
            report = check_package(package.root, package.manifest)
        else:
            report = check_run(settings, load_inputs(_resolve(app_ctx)))
    except MainGottError as error:
        console.print(f"[red]{error}[/red]")
        raise typer.Exit(EXIT_ERROR) from error
    _report_reproducibility(report)
    if not report.reproducible:
        raise typer.Exit(EXIT_ERROR)


@app.command()
def config(ctx: typer.Context) -> None:
    """Show the effective configuration. Secrets are never printed."""
    app_ctx = _context(ctx)
    table = Table(title="MainGott Reel Generator configuration", show_lines=False)
    table.add_column("setting", style="cyan")
    table.add_column("value")
    for key, value in app_ctx.settings.describe().items():
        table.add_row(key, str(value))
    console.print(table)


if __name__ == "__main__":  # pragma: no cover - exercised via the console script
    app()
