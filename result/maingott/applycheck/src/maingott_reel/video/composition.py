"""The ``compose`` stage.

Deterministic post-production: the approved storyboard and the validated
assets go in, a finished Reel comes out. No model is consulted, nothing
creative is decided here, and no approved wording is rewritten.

The stage is reproducible. Everything that decides what the file looks like —
scenes, clips, narration, music, logo, font, settings — is hashed into a
composition identity, so an unchanged run reuses its Reel and a changed one
never mistakes an obsolete file for a current one.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from PIL import Image
from PIL.Image import Resampling
from pydantic import ValidationError

from maingott_reel.assets.manager import check_inputs as check_upstream
from maingott_reel.assets.probe import MediaProbe, default_probe
from maingott_reel.audio.voice import voice_track
from maingott_reel.config import Settings
from maingott_reel.errors import CompositionError, StageNotCompletedError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    COMPOSITION_VERSION,
    AssetCollection,
    CaptionCue,
    Composition,
    CompositionSettings,
    FactRegistry,
    FontInfo,
    LogoPlan,
    SafeArea,
    ScriptPlan,
    StageName,
    Storyboard,
    TimelineScene,
    ValidationReport,
    VoiceAsset,
)
from maingott_reel.utils.ffmpeg import FFmpeg
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, resolve_run
from maingott_reel.video import encoder
from maingott_reel.video.captions import (
    DEFAULT_STYLES,
    find_font,
    font_identity,
    render_caption,
)
from maingott_reel.video.timeline import (
    assets_identity,
    build_audio_plan,
    build_captions,
    build_timeline,
    composition_identity,
)
from maingott_reel.video.validation import production_readiness, validate_reel

logger = get_logger("video.composition")

#: Where an approved logo is looked for when none is configured.
LOGO_CANDIDATES = ("logo.png", "logo-white.png", "logo-transparent.png")

#: Audio file types accepted as narration or music.
AUDIO_SUFFIXES = (".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg")


@dataclass(frozen=True)
class CompositionResult:
    """What the ``compose`` stage produced."""

    run: RunContext
    composition: Composition
    dry_run: bool
    reused: bool

    @property
    def output_path(self) -> Path | None:
        """The finished Reel, when one was written."""
        return self.composition.output_path

    @property
    def passed(self) -> bool:
        """Whether the finished file passed validation."""
        return self.composition.passed

    @property
    def development(self) -> bool:
        """Whether the Reel is missing production audio or branding."""
        return self.composition.development


def _load(run: RunContext) -> tuple[Storyboard, ScriptPlan, FactRegistry, AssetCollection]:
    """Load every artifact composition depends on.

    Raises:
        StageNotCompletedError: an artifact is missing or unreadable.
    """
    run.require(run.storyboard_json, "storyboard")
    run.require(run.script_json, "plan")
    run.require(run.facts_json, "analyze")
    run.require(run.assets_json, "generate-assets")
    try:
        return (
            read_model(run.storyboard_json, Storyboard),
            read_model(run.script_json, ScriptPlan),
            read_model(run.facts_json, FactRegistry),
            read_model(run.assets_json, AssetCollection),
        )
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"Run {run.run_id} has unreadable artifacts ({error}). Re-run the earlier stages."
        ) from error


def check_assets(run: RunContext, storyboard: Storyboard, assets: AssetCollection) -> None:
    """Refuse to compose from assets that do not match this storyboard.

    Raises:
        StageNotCompletedError: the assets are stale, incomplete or unusable.
    """
    if assets.narration_sha256 != storyboard.narration_sha256:
        raise StageNotCompletedError(
            f"The assets in run {run.run_id} were generated for a different plan. "
            "Re-run 'generate-assets'."
        )
    if assets.storyboard_sha256 != sha256_file(run.storyboard_json):
        raise StageNotCompletedError(
            f"The storyboard in run {run.run_id} changed after the assets were generated. "
            "Re-run 'generate-assets'."
        )
    missing = [scene.id for scene in storyboard.scenes if assets.for_scene(scene.id) is None]
    if missing:
        raise StageNotCompletedError(
            f"No asset was generated for: {', '.join(missing)}. Run 'generate-assets'."
        )
    unusable = [asset.scene_id for asset in assets.assets if not asset.is_usable]
    if unusable:
        raise StageNotCompletedError(
            f"These scenes have no usable footage: {', '.join(str(s) for s in unusable)}. "
            "Re-run 'generate-assets'."
        )
    unverified = [
        asset.scene_id
        for asset in assets.assets
        if asset.validation is not None and not asset.validation.passed
    ]
    if unverified:
        raise StageNotCompletedError(
            f"These assets did not pass asset validation: {', '.join(str(s) for s in unverified)}."
        )


def composition_settings(settings: Settings) -> CompositionSettings:
    """Build the post-production settings from configuration."""
    return CompositionSettings(
        width=settings.video_width,
        height=settings.video_height,
        fps=settings.video_fps,
        video_preset=settings.video_preset,
        video_crf=settings.video_crf,
        audio_bitrate=settings.audio_bitrate,
        transition_seconds=settings.transition_seconds,
        safe_area=SafeArea(),
    )


def resolve_logo(settings: Settings, allow_missing: bool) -> tuple[Path, int, int, bool] | None:
    """Find the approved brand mark.

    A logo is never generated or drawn from text: it is either an approved
    file or it is absent, and absence has to be acknowledged explicitly.

    Raises:
        CompositionError: no approved logo exists and none was waived, or the
            file is not a usable image.
    """
    candidates = (
        [settings.brand_logo]
        if settings.brand_logo is not None
        else [settings.brand_dir / name for name in LOGO_CANDIDATES]
    )
    found = next((path for path in candidates if path is not None and path.is_file()), None)
    if found is None:
        if allow_missing:
            return None
        raise CompositionError(
            f"No approved logo found in {settings.brand_dir}. Put an approved logo there "
            f"(one of {', '.join(LOGO_CANDIDATES)}), or compose with --no-logo for a "
            "development Reel."
        )
    try:
        with Image.open(found) as image:
            width, height = image.size
            has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
    except OSError as error:
        raise CompositionError(f"The logo at {found} is not a readable image: {error}") from error
    if width < 64 or height < 64:
        raise CompositionError(f"The logo at {found} is too small to render ({width}x{height}).")
    return found, width, height, has_alpha


def resolve_voice(
    run: RunContext,
    storyboard: Storyboard,
    voice: Path | None,
    silent_voice: bool,
) -> tuple[Path | None, VoiceAsset | None]:
    """Decide which narration is mixed in.

    Voice is an input to composition, not something it creates. An explicitly
    supplied file is used as given; otherwise the run's own generated
    narration is used, and only if it speaks this storyboard's approved
    script.

    Raises:
        CompositionError: the supplied file is missing, the run's narration
            belongs to a different script, or there is no narration at all and
            none was waived.
    """
    if voice is not None:
        if not voice.is_file():
            raise CompositionError(f"The narration track does not exist: {voice}")
        return voice, None
    if silent_voice:
        # An explicit request for a silent development Reel wins over
        # whatever the run happens to hold.
        return None, None

    generated = voice_track(run)
    if generated is not None and generated.path is not None:
        if generated.narration_sha256 != storyboard.narration_sha256:
            raise CompositionError(
                f"The narration in run {run.run_id} was generated from a different script "
                f"(voice {generated.narration_sha256[:12]}, storyboard "
                f"{storyboard.narration_sha256[:12]}). Re-run 'generate-voice'."
            )
        if not generated.path.is_file():
            raise CompositionError(
                f"The generated narration file is missing: {generated.path}. "
                "Re-run 'generate-voice'."
            )
        return generated.path, generated

    raise CompositionError(
        "No narration was supplied. Run 'generate-voice', pass --voice with an approved "
        "narration track, or use --silent-voice for a development Reel without it."
    )


def resolve_music(settings: Settings, music: Path | None) -> Path | None:
    """Find the optional music bed.

    Raises:
        CompositionError: an explicitly named track does not exist.
    """
    if music is not None:
        if not music.is_file():
            raise CompositionError(f"The music track does not exist: {music}")
        return music
    directory = settings.brand_music or (settings.brand_dir / "music")
    if not directory.is_dir():
        return None
    tracks = sorted(path for path in directory.iterdir() if path.suffix.lower() in AUDIO_SUFFIXES)
    return tracks[0] if tracks else None


def _logo_plan(
    logo: tuple[Path, int, int, bool], settings: CompositionSettings, scenes: list[TimelineScene]
) -> LogoPlan:
    """Place the brand mark over the closing scene."""
    path, width, height, has_alpha = logo
    closing = scenes[-1]
    render_width = round(settings.width * settings.logo_width_ratio)
    left, top, right, _bottom = settings.safe_area.box(settings.width, settings.height)
    return LogoPlan(
        path=path,
        sha256=sha256_file(path),
        width=width,
        height=height,
        has_alpha=has_alpha,
        start_seconds=closing.start_seconds,
        end_seconds=closing.end_seconds,
        position_x=left + (right - left - render_width) // 2,
        position_y=top + round(settings.height * 0.12),
        render_width=render_width,
    )


def _render_captions(
    cues: list[CaptionCue],
    settings: CompositionSettings,
    font: Path,
    directory: Path,
) -> list[CaptionCue]:
    """Draw every caption and attach its image path."""
    rendered: list[CaptionCue] = []
    for cue in cues:
        destination = directory / f"{cue.id.lower().replace('-', '_')}.png"
        render_caption(cue.text, cue.role, destination, settings, font, DEFAULT_STYLES)
        rendered.append(cue.model_copy(update={"image_path": destination}))
    return rendered


def _scaled_logo(logo: LogoPlan, directory: Path) -> Path:
    """Write the logo at its rendered size, ready to overlay."""
    destination = directory / "logo.png"
    with Image.open(logo.path) as image:
        prepared = image.convert("RGBA")
        height = round(prepared.height * logo.render_width / prepared.width)
        prepared.resize((logo.render_width, height), Resampling.LANCZOS).save(destination, "PNG")
    return destination


def _reusable(run: RunContext, identity: str) -> Composition | None:
    """Return an existing composition when it still describes this run."""
    if not run.composition_json.is_file():
        return None
    try:
        existing = read_model(run.composition_json, Composition)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("existing composition is unreadable", extra={"error": str(error)})
        return None
    if existing.composition_sha256 != identity:
        return None
    if existing.output_path is None or not existing.output_path.is_file():
        return None
    if existing.output_sha256 and sha256_file(existing.output_path) != existing.output_sha256:
        logger.warning("the finished Reel changed on disk, recomposing")
        return None
    return existing


def compose(
    settings: Settings,
    run_id: str | None = None,
    voice: Path | None = None,
    music: Path | None = None,
    no_logo: bool = False,
    silent_voice: bool = False,
    dry_run: bool = False,
    force: bool = False,
    probe: MediaProbe | None = None,
    ffmpeg: FFmpeg | None = None,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> CompositionResult:
    """Compose the final Reel.

    Args:
        settings: effective configuration.
        run_id: run to compose. Defaults to the most recent run.
        voice: narration track to mix in.
        music: music bed. Defaults to the first track in the brand music folder.
        no_logo: compose without a brand mark (development output).
        silent_voice: compose with a silent track (development output).
        dry_run: plan the composition and stop. Nothing is encoded.
        force: recompose even if this run already holds a matching Reel.
        probe: media inspector. Defaults to ffprobe.
        ffmpeg: FFmpeg wrapper. Defaults to the configured binary.
        source_path: overrides ``settings.source_document`` for staleness checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run is not ready to be composed.
        CompositionError: the Reel cannot be built from these inputs.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    storyboard, plan, registry, assets = _load(run)
    check_upstream(settings, run, storyboard, plan, registry, source_path)
    check_assets(run, storyboard, assets)

    voice_path, voice_asset = resolve_voice(run, storyboard, voice, silent_voice)

    render_settings = composition_settings(settings)
    media_probe = probe or default_probe(settings.ffprobe_bin)
    runner = ffmpeg or FFmpeg(settings.ffmpeg_bin)

    font_path = find_font(settings.caption_font)
    logo = resolve_logo(settings, allow_missing=no_logo)
    music_path = resolve_music(settings, music)
    audio = build_audio_plan(
        voice_path,
        music_path,
        render_settings,
        silent=silent_voice,
        voice=voice_asset,
    )
    audio = audio.model_copy(update={"music_gain_db": settings.music_gain_db})

    scenes = build_timeline(storyboard, assets, render_settings, probe=media_probe)
    captions = build_captions(storyboard, render_settings)
    logo_plan = _logo_plan(logo, render_settings, scenes) if logo else None

    identity = composition_identity(
        storyboard_sha256=assets.storyboard_sha256,
        assets_sha256=assets_identity(assets),
        audio=audio,
        logo_sha256=logo_plan.sha256 if logo_plan else None,
        font_identity=font_identity(font_path),
        settings=render_settings,
        version=COMPOSITION_VERSION,
    )

    if not force and not dry_run:
        existing = _reusable(run, identity)
        if existing is not None:
            logger.info("composition reused", extra={"run_id": run.run_id})
            return CompositionResult(run=run, composition=existing, dry_run=False, reused=True)

    composition = Composition(
        created_at=datetime.now(tz=UTC),
        run_id=run.run_id,
        language=storyboard.language,
        target_duration_seconds=storyboard.target_duration_seconds,
        timeline_duration_seconds=storyboard.total_duration_seconds,
        settings=render_settings,
        scenes=scenes,
        captions=captions,
        audio=audio,
        logo=logo_plan,
        font=FontInfo(family=font_path.stem, path=font_path, sha256=sha256_file(font_path)),
        styles=list(DEFAULT_STYLES),
        source_sha256=registry.source_sha256,
        storyboard_sha256=assets.storyboard_sha256,
        narration_sha256=storyboard.narration_sha256,
        assets_sha256=assets_identity(assets),
        composition_sha256=identity,
        # A Reel is a development output when anything a viewer would notice
        # is standing in for the real thing.
        development=audio.silent or audio.voice_is_development or logo_plan is None,
    )

    if dry_run:
        logger.info(
            "composition planned",
            extra={
                "run_id": run.run_id,
                "scenes": composition.scene_count,
                "duration": composition.timeline_duration_seconds,
                "captions": len(captions),
                "development": composition.development,
            },
        )
        return CompositionResult(run=run, composition=composition, dry_run=True, reused=False)

    composition = _render(composition, run, runner, media_probe, storyboard, plan)
    write_model(run.composition_json, composition)
    _record_stage(run, composition)

    logger.info(
        "composition complete",
        extra={
            "run_id": run.run_id,
            "output": str(composition.output_path),
            "duration": composition.timeline_duration_seconds,
            "passed": composition.passed,
            "development": composition.development,
        },
    )
    return CompositionResult(run=run, composition=composition, dry_run=False, reused=False)


def _render(
    composition: Composition,
    run: RunContext,
    ffmpeg: FFmpeg,
    probe: MediaProbe,
    storyboard: Storyboard,
    plan: ScriptPlan,
) -> Composition:
    """Run the FFmpeg passes and validate the result."""
    encoder.require_ffmpeg(ffmpeg)
    paths = encoder.CompositionPaths(run.composition_dir)
    paths.create()

    settings = composition.settings
    normalized: list[TimelineScene] = []
    for index, scene in enumerate(composition.scenes):
        previous = composition.scenes[index - 1] if index else None
        path = encoder.normalize_scene(scene, previous, settings, paths, ffmpeg)
        normalized.append(scene.model_copy(update={"normalized_path": path}))

    sequence = encoder.build_sequence(normalized, settings, paths, ffmpeg)

    captions = _render_captions(
        composition.captions, settings, composition.font.path, paths.captions
    )
    logo = composition.logo
    if logo is not None:
        logo = logo.model_copy(update={"path": _scaled_logo(logo, paths.captions)})

    picture = encoder.overlay_text_and_logo(sequence, captions, logo, settings, paths, ffmpeg)
    audio = encoder.build_audio(
        composition.audio, composition.timeline_duration_seconds, settings, paths, ffmpeg
    )
    final = encoder.mux(
        picture,
        audio,
        run.final_video,
        composition.timeline_duration_seconds,
        settings,
        ffmpeg,
    )

    rendered = composition.model_copy(
        update={
            "scenes": normalized,
            "captions": captions,
            "logo": logo,
            "output_path": final,
            "output_sha256": sha256_file(final),
            "output_size_bytes": final.stat().st_size,
        }
    )
    report = validate_reel(final, rendered, storyboard, plan, probe)
    # Readiness is reported separately: a development Reel is a valid file
    # that simply must not be published.
    readiness = ValidationReport(
        created_at=datetime.now(tz=UTC), checks=production_readiness(rendered)
    )
    return rendered.model_copy(update={"validation": report, "readiness": readiness})


def _record_stage(run: RunContext, composition: Composition) -> None:
    """Write the composition's outcome into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.composition = composition.settings
    manifest.validation = composition.validation
    manifest.files["composition"] = run.composition_json
    if composition.output_path is not None:
        manifest.files["final"] = composition.output_path
    manifest.record_stage(
        StageName.COMPOSE,
        completed_at=composition.created_at,
        artifact=composition.output_path,
        notes=(
            f"{composition.scene_count} scenes, {composition.timeline_duration_seconds}s, "
            f"{composition.settings.width}x{composition.settings.height}, "
            f"composition {composition.composition_sha256[:12]}, "
            f"{'development' if composition.development else 'production'} output"
        ),
    )
    save_manifest(run, manifest)
