"""The compose stage.

Composition runs for real here: FFmpeg encodes actual clips produced by the
offline provider, on a smaller 9:16 canvas so the suite stays quick. No
network, no API key, no paid generation.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.probe import FFProbe
from maingott_reel.config import Settings
from maingott_reel.errors import CompositionError, RunNotFoundError, StageNotCompletedError
from maingott_reel.models import (
    AssetCollection,
    Composition,
    RunManifest,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.utils.jsonio import read_model, write_json, write_model
from maingott_reel.utils.run_context import RunContext, create_run
from maingott_reel.video.composition import compose, resolve_logo, resolve_music


def _probe(settings: Settings) -> FFProbe:
    return FFProbe(settings.ffprobe_bin)


# --- dry run -----------------------------------------------------------------


def test_dry_run_plans_without_encoding(compose_settings: Settings, composed_run: RunContext):
    result = compose(
        compose_settings,
        run_id=composed_run.run_id,
        silent_voice=True,
        no_logo=True,
        dry_run=True,
    )

    assert result.dry_run
    assert result.composition.scene_count == 8
    assert result.composition.timeline_duration_seconds == 40.0
    assert result.composition.settings.width == 540
    assert len(result.composition.captions) == 8
    assert not composed_run.final_video.exists()
    assert not composed_run.composition_json.exists()


def test_dry_run_reports_the_geometry(compose_settings: Settings, composed_run: RunContext):
    result = compose(
        compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True, dry_run=True
    )
    for scene in result.composition.scenes:
        assert scene.geometry.output_width == 540
        assert scene.geometry.output_height == 960


# --- composing ----------------------------------------------------------------


def test_a_reel_is_composed(compose_settings: Settings, composed_run: RunContext):
    result = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)

    assert result.passed, result.composition.validation
    assert result.output_path == composed_run.final_video
    assert composed_run.final_video.is_file()

    info = _probe(compose_settings).inspect(composed_run.final_video)
    assert (info.width, info.height) == (540, 960)
    assert info.height > info.width
    assert abs(info.duration_seconds - 40.0) <= 0.25
    assert info.codec == "h264"
    assert info.has_audio_stream


def test_the_finished_reel_follows_the_storyboard(
    compose_settings: Settings, composed_run: RunContext, storyboard_fixture: Storyboard
):
    result = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    composition = result.composition

    assert [scene.scene_id for scene in composition.scenes] == [
        scene.id for scene in storyboard_fixture.scenes
    ]
    assert [cue.text for cue in composition.captions] == [
        scene.overlay_text for scene in storyboard_fixture.scenes if scene.overlay_text
    ]
    assert composition.narration_sha256 == storyboard_fixture.narration_sha256


def test_fractional_scene_durations_are_honoured(
    compose_settings: Settings, composed_run: RunContext, storyboard_fixture: Storyboard
):
    result = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    for scene, approved in zip(result.composition.scenes, storyboard_fixture.scenes, strict=True):
        assert scene.duration_seconds == approved.duration_seconds
        assert scene.trim_duration_seconds <= scene.source_duration_seconds + 0.01


def test_intermediates_are_kept_and_raw_assets_are_untouched(
    compose_settings: Settings, composed_run: RunContext
):
    assets = read_model(composed_run.assets_json, AssetCollection)
    before = {
        asset.scene_id: (asset.path.read_bytes() if asset.path else b"") for asset in assets.assets
    }

    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)

    after = {
        asset.scene_id: (asset.path.read_bytes() if asset.path else b"") for asset in assets.assets
    }
    assert before == after, "composition must never modify generated assets"
    assert (composed_run.composition_dir / "normalized").is_dir()
    assert list((composed_run.composition_dir / "captions").glob("*.png"))
    assert (composed_run.composition_dir / "video" / "sequence.mp4").is_file()
    assert (composed_run.composition_dir / "audio" / "mix.m4a").is_file()


def test_artifacts_and_manifest_are_written(compose_settings: Settings, composed_run: RunContext):
    result = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)

    stored = read_model(composed_run.composition_json, Composition)
    assert stored.composition_sha256 == result.composition.composition_sha256
    assert stored.output_sha256 == result.composition.output_sha256

    # The encode-time report travels with the composition; the run-level
    # verdict in validation.json is the audit stage's to write.
    assert stored.validation is not None
    assert stored.validation.passed
    assert not composed_run.validation_json.exists()

    manifest = read_model(composed_run.manifest_json, RunManifest)
    from maingott_reel.models import StageName

    assert manifest.stage_completed(StageName.COMPOSE)
    assert manifest.composition is not None
    assert set(manifest.files) >= {"composition", "final"}


def test_a_silent_reel_is_marked_as_development(
    compose_settings: Settings, composed_run: RunContext
):
    result = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    assert result.development
    assert result.composition.readiness is not None
    assert not result.composition.readiness.passed


def test_narration_and_a_logo_make_it_production(
    compose_settings: Settings,
    composed_run: RunContext,
    silent_voice_track: Path,
    logo_file: Path,
):
    settings = compose_settings.model_copy(update={"brand_logo": logo_file})
    result = compose(settings, run_id=composed_run.run_id, voice=silent_voice_track)

    assert result.passed
    assert not result.development
    assert result.composition.logo is not None
    assert result.composition.readiness is not None
    assert result.composition.readiness.passed
    info = _probe(settings).inspect(composed_run.final_video)
    assert info.has_audio_stream


def test_music_is_mixed_in(
    compose_settings: Settings,
    composed_run: RunContext,
    silent_voice_track: Path,
    tmp_path: Path,
):
    music = tmp_path / "music.m4a"
    music.write_bytes(silent_voice_track.read_bytes())

    result = compose(
        compose_settings,
        run_id=composed_run.run_id,
        voice=silent_voice_track,
        music=music,
        no_logo=True,
    )

    assert result.composition.audio.has_music
    assert result.composition.audio.music_sha256
    assert result.passed


def test_audio_cannot_stretch_the_reel(
    compose_settings: Settings, composed_run: RunContext, silent_voice_track: Path
):
    result = compose(
        compose_settings, run_id=composed_run.run_id, voice=silent_voice_track, no_logo=True
    )
    info = _probe(compose_settings).inspect(composed_run.final_video)
    assert abs(info.duration_seconds - result.composition.timeline_duration_seconds) <= 0.25


# --- narration from the voice stage ------------------------------------------------


def _voiced(settings: Settings, run: RunContext) -> VoiceAsset | None:
    """Generate the run's narration offline."""
    from maingott_reel.audio.voice import generate_voice

    result = generate_voice(settings, run_id=run.run_id, offline=True)
    assert result.complete, "the offline provider should produce a track"
    return result.asset


def test_the_runs_own_narration_is_used_without_being_asked_for(
    compose_settings: Settings, composed_run: RunContext
):
    voice = _voiced(compose_settings, composed_run)
    assert voice is not None

    result = compose(compose_settings, run_id=composed_run.run_id, no_logo=True)

    audio = result.composition.audio
    assert not audio.silent
    assert audio.voice_path == voice.path
    assert audio.voice_asset_id == voice.id
    assert audio.voice_narration_sha256 == voice.narration_sha256
    assert audio.voice_provider == voice.provider
    assert audio.voice_model == voice.model
    assert audio.voice_is_development
    assert result.passed


def test_a_placeholder_voice_keeps_the_reel_a_development_output(
    compose_settings: Settings, composed_run: RunContext, logo_file: Path
):
    settings = compose_settings.model_copy(update={"brand_logo": logo_file})
    _voiced(settings, composed_run)

    result = compose(settings, run_id=composed_run.run_id)

    assert result.development
    assert result.composition.logo is not None


def test_narration_generated_from_another_script_is_refused(
    compose_settings: Settings, composed_run: RunContext
):
    _voiced(compose_settings, composed_run)
    stored = read_model(composed_run.voice_json, VoiceAsset)
    write_model(composed_run.voice_json, stored.model_copy(update={"narration_sha256": "c" * 64}))

    with pytest.raises(CompositionError, match="different script"):
        compose(compose_settings, run_id=composed_run.run_id, no_logo=True, dry_run=True)


def test_a_deleted_narration_file_is_refused(compose_settings: Settings, composed_run: RunContext):
    voice = _voiced(compose_settings, composed_run)
    assert voice is not None and voice.path is not None
    voice.path.unlink()

    with pytest.raises(CompositionError, match="Re-run 'generate-voice'"):
        compose(compose_settings, run_id=composed_run.run_id, no_logo=True, dry_run=True)


def test_an_explicit_track_wins_over_the_generated_one(
    compose_settings: Settings, composed_run: RunContext, silent_voice_track: Path
):
    _voiced(compose_settings, composed_run)

    result = compose(
        compose_settings,
        run_id=composed_run.run_id,
        voice=silent_voice_track,
        no_logo=True,
        dry_run=True,
    )

    assert result.composition.audio.voice_path == silent_voice_track
    assert result.composition.audio.voice_asset_id is None


def test_silence_can_still_be_asked_for_explicitly(
    compose_settings: Settings, composed_run: RunContext
):
    _voiced(compose_settings, composed_run)

    result = compose(
        compose_settings,
        run_id=composed_run.run_id,
        silent_voice=True,
        no_logo=True,
        dry_run=True,
    )

    assert result.composition.audio.silent


def test_the_narration_changes_the_composition_identity(
    compose_settings: Settings, composed_run: RunContext
):
    silent = compose(
        compose_settings,
        run_id=composed_run.run_id,
        silent_voice=True,
        no_logo=True,
        dry_run=True,
    )
    _voiced(compose_settings, composed_run)
    voiced = compose(compose_settings, run_id=composed_run.run_id, no_logo=True, dry_run=True)

    assert silent.composition.composition_sha256 != voiced.composition.composition_sha256


# --- inputs that must be refused ------------------------------------------------


def test_narration_is_required_unless_waived(compose_settings: Settings, composed_run: RunContext):
    with pytest.raises(CompositionError, match="No narration"):
        compose(compose_settings, run_id=composed_run.run_id, no_logo=True)


def test_a_missing_logo_must_be_acknowledged(compose_settings: Settings, composed_run: RunContext):
    with pytest.raises(CompositionError, match="No approved logo"):
        compose(compose_settings, run_id=composed_run.run_id, silent_voice=True)


def test_a_missing_music_file_is_reported(
    compose_settings: Settings, composed_run: RunContext, tmp_path: Path
):
    with pytest.raises(CompositionError, match="music track does not exist"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            music=tmp_path / "absent.mp3",
        )


def test_an_unreadable_logo_is_reported(compose_settings: Settings, tmp_path: Path):
    broken = tmp_path / "input" / "brand" / "logo.png"
    broken.parent.mkdir(parents=True, exist_ok=True)
    broken.write_bytes(b"not an image")
    with pytest.raises(CompositionError, match="not a readable image"):
        resolve_logo(
            compose_settings.model_copy(update={"brand_logo": broken}), allow_missing=False
        )


def test_a_tiny_logo_is_reported(compose_settings: Settings, tmp_path: Path):
    from PIL import Image

    small = tmp_path / "small.png"
    Image.new("RGBA", (16, 16)).save(small)
    with pytest.raises(CompositionError, match="too small"):
        resolve_logo(compose_settings.model_copy(update={"brand_logo": small}), allow_missing=False)


def test_a_logo_is_found_in_the_brand_directory(compose_settings: Settings, logo_file: Path):
    settings = compose_settings.model_copy(update={"brand_dir": logo_file.parent})
    found = resolve_logo(settings, allow_missing=False)
    assert found is not None
    assert found[0] == logo_file


def test_music_is_optional(compose_settings: Settings):
    assert resolve_music(compose_settings, None) is None


def test_without_a_run_it_fails(compose_settings: Settings):
    with pytest.raises(RunNotFoundError):
        compose(compose_settings, silent_voice=True, no_logo=True, dry_run=True)


def test_without_assets_it_fails(
    compose_settings: Settings, registry, script_plan, storyboard_fixture: Storyboard
):
    from maingott_reel.models import StageName
    from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest

    run = create_run(compose_settings, run_id="no-assets")
    write_model(run.facts_json, registry)
    write_model(run.script_json, script_plan)
    write_model(run.storyboard_json, storyboard_fixture)
    manifest = load_or_create_manifest(run)
    manifest.source_sha256 = registry.source_sha256
    manifest.record_stage(StageName.ANALYZE, completed_at=registry.created_at)
    save_manifest(run, manifest)

    with pytest.raises(StageNotCompletedError, match="generate-assets"):
        compose(compose_settings, run_id=run.run_id, silent_voice=True, no_logo=True, dry_run=True)


def test_assets_from_another_plan_are_refused(compose_settings: Settings, composed_run: RunContext):
    assets = read_model(composed_run.assets_json, AssetCollection).model_dump(mode="json")
    assets["narration_sha256"] = "f" * 64
    write_json(composed_run.assets_json, assets)

    with pytest.raises(StageNotCompletedError, match="different plan"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            dry_run=True,
        )


def test_a_storyboard_changed_after_generation_is_refused(
    compose_settings: Settings, composed_run: RunContext, storyboard_fixture: Storyboard
):
    payload = storyboard_fixture.model_dump(mode="json")
    payload["scenes"][0]["visual_description"] = "Другая сцена целиком."
    write_json(composed_run.storyboard_json, payload)

    with pytest.raises(StageNotCompletedError, match="changed after the assets"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            dry_run=True,
        )


def test_a_failed_asset_blocks_composition(compose_settings: Settings, composed_run: RunContext):
    assets = read_model(composed_run.assets_json, AssetCollection).model_dump(mode="json")
    assets["assets"][0].update(
        {"status": "failed", "path": None, "sha256": None, "error": "the model refused"}
    )
    write_json(composed_run.assets_json, assets)

    with pytest.raises(StageNotCompletedError, match="no usable footage"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            dry_run=True,
        )


def test_a_missing_clip_is_refused(compose_settings: Settings, composed_run: RunContext):
    assets = read_model(composed_run.assets_json, AssetCollection)
    path = assets.assets[0].path
    assert path is not None
    path.unlink()

    with pytest.raises(CompositionError, match="missing"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            dry_run=True,
        )


def test_a_corrupted_clip_is_refused(compose_settings: Settings, composed_run: RunContext):
    assets = read_model(composed_run.assets_json, AssetCollection)
    path = assets.assets[0].path
    assert path is not None
    path.write_bytes(b"not a video at all")

    with pytest.raises(CompositionError, match="cannot be read"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            dry_run=True,
        )


def test_ffmpeg_failures_are_surfaced(compose_settings: Settings, composed_run: RunContext):
    from maingott_reel.utils.ffmpeg import FFmpeg, FFmpegError

    with pytest.raises((CompositionError, FFmpegError), match=r"FFmpeg|ffmpeg"):
        compose(
            compose_settings,
            run_id=composed_run.run_id,
            silent_voice=True,
            no_logo=True,
            ffmpeg=FFmpeg("definitely-not-installed-ffmpeg"),
        )


# --- reuse ---------------------------------------------------------------------


def test_an_unchanged_composition_is_reused(compose_settings: Settings, composed_run: RunContext):
    first = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    before = composed_run.final_video.read_bytes()

    second = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)

    assert second.reused
    assert composed_run.final_video.read_bytes() == before
    assert second.composition.composition_sha256 == first.composition.composition_sha256


def test_force_recomposes(compose_settings: Settings, composed_run: RunContext):
    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    again = compose(
        compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True, force=True
    )
    assert not again.reused


def test_changed_audio_invalidates_the_reel(
    compose_settings: Settings, composed_run: RunContext, silent_voice_track: Path
):
    silent = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    with_voice = compose(
        compose_settings, run_id=composed_run.run_id, voice=silent_voice_track, no_logo=True
    )
    assert not with_voice.reused
    assert with_voice.composition.composition_sha256 != silent.composition.composition_sha256


def test_a_deleted_reel_is_recomposed(compose_settings: Settings, composed_run: RunContext):
    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    composed_run.final_video.unlink()

    again = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    assert not again.reused
    assert composed_run.final_video.is_file()


def test_a_tampered_reel_is_recomposed(compose_settings: Settings, composed_run: RunContext):
    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    composed_run.final_video.write_bytes(b"tampered")

    again = compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    assert not again.reused
    assert again.passed


# --- encoder passes in isolation ------------------------------------------------


def _tiny_clip(path: Path, ffmpeg_paths: tuple[str, str], seconds: float = 2.0) -> Path:
    from maingott_reel.utils.ffmpeg import FFmpeg

    FFmpeg(ffmpeg_paths[0]).encode(
        inputs=[Path("color=c=0x101820:s=90x160:r=12")],
        output=path,
        extra_input_args=[["-f", "lavfi"]],
        codec_args=[
            "-t",
            str(seconds),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "35",
            "-pix_fmt",
            "yuv420p",
        ],
        label="tiny clip",
    )
    return path


def _timeline_scene(
    index: int, clip: Path, start: float, duration: float, transition: str
) -> object:
    from maingott_reel.models import ScaleCrop, SceneTransition, TimelineScene

    return TimelineScene(
        scene_id=f"S-{index:02d}",
        beat_id=f"B-{index:02d}",
        order=index,
        asset_id=f"S-{index:02d}-video-abc",
        source_path=clip,
        source_duration_seconds=2.0,
        trim_duration_seconds=duration,
        start_seconds=start,
        duration_seconds=duration,
        transition=SceneTransition(transition),
        geometry=ScaleCrop(
            source_width=90,
            source_height=160,
            scaled_width=90,
            scaled_height=160,
            crop_x=0,
            crop_y=0,
            output_width=90,
            output_height=160,
        ),
    )


def test_a_fade_between_scenes_is_rendered_inside_their_own_time(
    ffmpeg_paths: tuple[str, str], tmp_path: Path
):
    from maingott_reel.models import CompositionSettings
    from maingott_reel.utils.ffmpeg import FFmpeg
    from maingott_reel.video import encoder

    clip = _tiny_clip(tmp_path / "clip.mp4", ffmpeg_paths)
    settings = CompositionSettings(
        width=90, height=160, fps=12, video_preset="ultrafast", video_crf=35
    )
    paths = encoder.CompositionPaths(tmp_path / "composition")
    paths.create()
    ffmpeg = FFmpeg(ffmpeg_paths[0])

    first = _timeline_scene(1, clip, 0.0, 1.0, "fade")
    second = _timeline_scene(2, clip, 1.0, 1.0, "cut")
    first_path = encoder.normalize_scene(first, None, settings, paths, ffmpeg)  # type: ignore[arg-type]
    second_path = encoder.normalize_scene(second, first, settings, paths, ffmpeg)  # type: ignore[arg-type]

    assert first_path.is_file()
    assert second_path.is_file()
    info = FFProbe(ffmpeg_paths[1]).inspect(second_path)
    assert abs(info.duration_seconds - 1.0) < 0.2


def test_a_single_scene_still_produces_a_sequence(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    from maingott_reel.models import CompositionSettings
    from maingott_reel.utils.ffmpeg import FFmpeg
    from maingott_reel.video import encoder

    clip = _tiny_clip(tmp_path / "clip.mp4", ffmpeg_paths)
    settings = CompositionSettings(
        width=90, height=160, fps=12, video_preset="ultrafast", video_crf=35
    )
    paths = encoder.CompositionPaths(tmp_path / "composition")
    paths.create()
    ffmpeg = FFmpeg(ffmpeg_paths[0])

    scene = _timeline_scene(1, clip, 0.0, 1.0, "cut")
    normalized = encoder.normalize_scene(scene, None, settings, paths, ffmpeg)  # type: ignore[arg-type]
    sequence = encoder.build_sequence(
        [scene.model_copy(update={"normalized_path": normalized})],  # type: ignore[attr-defined]
        settings,
        paths,
        ffmpeg,
    )
    assert sequence.is_file()


def test_a_sequence_needs_normalized_scenes(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    from maingott_reel.models import CompositionSettings
    from maingott_reel.utils.ffmpeg import FFmpeg
    from maingott_reel.video import encoder

    clip = _tiny_clip(tmp_path / "clip.mp4", ffmpeg_paths)
    paths = encoder.CompositionPaths(tmp_path / "composition")
    paths.create()
    scenes = [_timeline_scene(1, clip, 0.0, 1.0, "cut"), _timeline_scene(2, clip, 1.0, 1.0, "cut")]
    with pytest.raises(CompositionError, match="not been normalized"):
        encoder.build_sequence(
            scenes,  # type: ignore[arg-type]
            CompositionSettings(width=90, height=160),
            paths,
            FFmpeg(ffmpeg_paths[0]),
        )


def test_a_sequence_without_overlays_is_passed_through(
    ffmpeg_paths: tuple[str, str], tmp_path: Path
):
    from maingott_reel.models import CompositionSettings
    from maingott_reel.utils.ffmpeg import FFmpeg
    from maingott_reel.video import encoder

    clip = _tiny_clip(tmp_path / "clip.mp4", ffmpeg_paths)
    paths = encoder.CompositionPaths(tmp_path / "composition")
    paths.create()
    result = encoder.overlay_text_and_logo(
        clip, [], None, CompositionSettings(width=90, height=160), paths, FFmpeg(ffmpeg_paths[0])
    )
    assert result == clip


def test_an_unrendered_caption_is_refused(ffmpeg_paths: tuple[str, str], tmp_path: Path):
    from maingott_reel.models import CaptionCue, CompositionSettings, TextRole
    from maingott_reel.utils.ffmpeg import FFmpeg
    from maingott_reel.video import encoder

    clip = _tiny_clip(tmp_path / "clip.mp4", ffmpeg_paths)
    paths = encoder.CompositionPaths(tmp_path / "composition")
    paths.create()
    cue = CaptionCue(
        id="C-01",
        scene_id="S-01",
        text="Разные каналы",
        role=TextRole.CAPTION,
        start_seconds=0.0,
        end_seconds=1.0,
    )
    with pytest.raises(CompositionError, match="not been rendered"):
        encoder.overlay_text_and_logo(
            clip,
            [cue],
            None,
            CompositionSettings(width=90, height=160),
            paths,
            FFmpeg(ffmpeg_paths[0]),
        )
