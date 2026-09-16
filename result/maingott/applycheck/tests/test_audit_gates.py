"""The individual quality gates.

These run against constructed artifacts, so they need no FFmpeg and no
encoding: each gate is checked for the fault it exists to catch.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from PIL import Image

from maingott_reel.assets.probe import MediaInfo, ProbeError
from maingott_reel.audit.gates import (
    MIN_LOGO_WIDTH_RATIO,
    asset_gates,
    claim_gates,
    file_gates,
    placeholder_gate,
    presentation_gates,
    readiness_gates,
    run_gates,
    voice_gates,
)
from maingott_reel.models import (
    AssetCollection,
    AudioPlan,
    CaptionCue,
    Composition,
    CompositionSettings,
    CreativeBrief,
    FactRegistry,
    FontInfo,
    GateGroup,
    GateSeverity,
    LogoPlan,
    QualityGate,
    QualityReport,
    RunManifest,
    ScaleCrop,
    ScriptPlan,
    StageName,
    Storyboard,
    TextRole,
    TimelineScene,
    VoiceAsset,
)
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import write_model

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO = "0" * 64
SOURCE = "a" * 64


def _named(gates: list[QualityGate]) -> dict[str, QualityGate]:
    return {gate.name: gate for gate in gates}


def _failed(gates: list[QualityGate]) -> set[str]:
    return {gate.name for gate in gates if not gate.passed}


@pytest.fixture
def storyboard_path(tmp_path: Path, storyboard_fixture: Storyboard) -> Path:
    path = tmp_path / "storyboard.json"
    write_model(path, storyboard_fixture)
    return path


@pytest.fixture
def assets(
    tmp_path: Path, storyboard_fixture: Storyboard, storyboard_path: Path
) -> AssetCollection:
    from maingott_reel.models import Asset, AssetStatus, AssetType

    items = []
    for index, scene in enumerate(storyboard_fixture.scenes, start=1):
        clip = tmp_path / f"scene_{index:02d}.mp4"
        clip.write_bytes(b"clip" * 512)
        items.append(
            Asset(
                id=f"{scene.id}-video-abc{index:03d}",
                asset_type=AssetType.VIDEO,
                status=AssetStatus.READY,
                scene_id=scene.id,
                beat_id=scene.beat_id,
                path=clip,
                sha256=sha256_file(clip),
            )
        )
    return AssetCollection(
        created_at=NOW,
        source_sha256=SOURCE,
        storyboard_sha256=sha256_file(storyboard_path),
        narration_sha256=storyboard_fixture.narration_sha256,
        provider="fake",
        model="offline-video",
        assets=items,
    )


@pytest.fixture
def composition(
    tmp_path: Path, storyboard_fixture: Storyboard, storyboard_path: Path
) -> Composition:
    settings = CompositionSettings()
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip")
    scenes = []
    start = 0.0
    for position, scene in enumerate(storyboard_fixture.scenes, start=1):
        scenes.append(
            TimelineScene(
                scene_id=scene.id,
                beat_id=scene.beat_id,
                order=position,
                asset_id=f"{scene.id}-video-abc",
                source_path=clip,
                source_duration_seconds=12.0,
                trim_duration_seconds=scene.duration_seconds,
                start_seconds=round(start, 3),
                duration_seconds=scene.duration_seconds,
                geometry=ScaleCrop(
                    source_width=720,
                    source_height=1280,
                    scaled_width=1080,
                    scaled_height=1920,
                    crop_x=0,
                    crop_y=0,
                    output_width=1080,
                    output_height=1920,
                ),
            )
        )
        start += scene.duration_seconds

    captions = [
        CaptionCue(
            id=f"C-{index:02d}",
            scene_id=scene.id,
            text=scene.overlay_text,
            role=TextRole.CAPTION,
            start_seconds=scene.start_seconds,
            end_seconds=scene.end_seconds,
            image_path=_caption_image(tmp_path / f"c_{index:02d}.png", settings),
        )
        for index, scene in enumerate(storyboard_fixture.scenes, start=1)
        if scene.overlay_text
    ]
    return Composition(
        created_at=NOW,
        run_id="run-1",
        target_duration_seconds=40,
        timeline_duration_seconds=40.0,
        settings=settings,
        scenes=scenes,
        captions=captions,
        audio=AudioPlan(silent=True),
        font=FontInfo(family="DejaVuSans", path=Path("font.ttf"), sha256=ZERO),
        source_sha256=SOURCE,
        storyboard_sha256=sha256_file(storyboard_path),
        narration_sha256=storyboard_fixture.narration_sha256,
        assets_sha256=ZERO,
        composition_sha256=ZERO,
        development=True,
    )


def _caption_image(path: Path, settings: CompositionSettings, inside: bool = True) -> Path:
    """Draw ink either inside or outside the safe area."""
    left, top, right, bottom = settings.safe_area.box(settings.width, settings.height)
    image = Image.new("RGBA", (settings.width, settings.height), (0, 0, 0, 0))
    box = (left + 20, top + 20, right - 20, bottom - 20) if inside else (2, 2, 60, 60)
    for x in range(box[0], box[2], 4):
        for y in range(box[1], box[3], 4):
            image.putpixel((x, y), (255, 255, 255, 255))
    image.save(path, "PNG")
    return path


@pytest.fixture
def manifest() -> RunManifest:
    complete = RunManifest(run_id="run-1", created_at=NOW, app_version="0.1.0")
    for stage in (
        StageName.ANALYZE,
        StageName.PLAN,
        StageName.STORYBOARD,
        StageName.GENERATE_ASSETS,
        StageName.COMPOSE,
    ):
        complete.record_stage(stage, completed_at=NOW)
    complete.files = {
        name: Path(f"{name}.json")
        for name in (
            "source",
            "facts",
            "creative_brief",
            "script",
            "storyboard",
            "assets",
            "composition",
            "final",
        )
    }
    return complete


@pytest.fixture
def brief() -> CreativeBrief:
    return CreativeBrief(
        objective="Представить MainGott как единую систему продаж и операций.",
        audience="Руководители бизнеса",
        target_duration_seconds=40,
        tone="спокойный и уверенный",
        visual_direction="тёмная премиальная среда",
        core_message="MainGott — Sales & Operations OS.",
        cta="MAINGOTT",
    )


# --- the run holds together ---------------------------------------------------


def test_a_complete_run_passes_the_run_gates(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        composition,
        storyboard_path,
        None,
    )
    assert not _failed(gates), _failed(gates)


def test_a_missing_stage_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    manifest.stages = [stage for stage in manifest.stages if stage.stage is not StageName.COMPOSE]
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        composition,
        storyboard_path,
        None,
    )
    assert "every_stage_completed" in _failed(gates)


def test_an_untracked_artifact_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    manifest.files.pop("final")
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        composition,
        storyboard_path,
        None,
    )
    assert "artifacts_tracked_in_manifest" in _failed(gates)


def test_a_split_source_chain_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    drifted = assets.model_copy(update={"source_sha256": "b" * 64})
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        drifted,
        composition,
        storyboard_path,
        None,
    )
    assert "one_source_specification" in _failed(gates)


def test_a_split_narration_chain_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    drifted = composition.model_copy(update={"narration_sha256": "c" * 64})
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        drifted,
        storyboard_path,
        None,
    )
    assert "one_approved_narration" in _failed(gates)


def test_a_storyboard_edited_after_generation_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
):
    storyboard_path.write_text(storyboard_path.read_text() + "\n", encoding="utf-8")
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        composition,
        storyboard_path,
        None,
    )
    failed = _failed(gates)
    assert "assets_match_the_storyboard" in failed
    assert "composition_matches_the_storyboard" in failed


def test_a_changed_source_document_is_caught(
    manifest: RunManifest,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
    tmp_path: Path,
):
    source = tmp_path / "spec.docx"
    source.write_bytes(b"a different specification")
    gates = run_gates(
        manifest,
        registry,
        script_plan,
        storyboard_fixture,
        assets,
        composition,
        storyboard_path,
        source,
    )
    assert "source_document_unchanged" in _failed(gates)


# --- assets ---------------------------------------------------------------------


def test_intact_assets_pass(assets: AssetCollection, storyboard_fixture: Storyboard):
    assert not _failed(asset_gates(assets, storyboard_fixture))


def test_a_deleted_clip_is_caught(assets: AssetCollection, storyboard_fixture: Storyboard):
    path = assets.assets[0].path
    assert path is not None
    path.unlink()
    assert "asset_files_are_present" in _failed(asset_gates(assets, storyboard_fixture))


def test_a_tampered_clip_is_caught(assets: AssetCollection, storyboard_fixture: Storyboard):
    path = assets.assets[0].path
    assert path is not None
    path.write_bytes(b"different bytes entirely")
    assert "asset_files_are_unchanged" in _failed(asset_gates(assets, storyboard_fixture))


def test_a_scene_without_an_asset_is_caught(
    assets: AssetCollection, storyboard_fixture: Storyboard
):
    thinned = assets.model_copy(update={"assets": assets.assets[1:]})
    assert "every_scene_has_an_asset" in _failed(asset_gates(thinned, storyboard_fixture))


def test_a_failed_asset_is_caught(assets: AssetCollection, storyboard_fixture: Storyboard):
    from maingott_reel.models import AssetStatus

    broken = assets.assets[0].model_construct(
        **{**assets.assets[0].__dict__, "status": AssetStatus.FAILED, "error": "refused"}
    )
    collection = assets.model_copy(update={"assets": [broken, *assets.assets[1:]]})
    assert "every_asset_is_usable" in _failed(asset_gates(collection, storyboard_fixture))


# --- claims -----------------------------------------------------------------------


def test_an_approved_plan_passes_the_claim_gates(
    script_plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard_fixture: Storyboard,
    composition: Composition,
    registry: FactRegistry,
):
    gates = claim_gates(script_plan, brief, storyboard_fixture, composition, registry, 30, 45)
    assert not _failed(gates), _failed(gates)


def test_an_unsupported_claim_is_caught(
    script_plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard_fixture: Storyboard,
    composition: Composition,
    registry: FactRegistry,
):
    from maingott_reel.models import ClaimReference

    beats = list(script_plan.beats)
    beats[2] = beats[2].model_copy(
        update={
            "claims": [
                ClaimReference(claim="Тысячи компаний уже с нами.", source_fact_ids=["F-901"])
            ]
        }
    )
    plan = script_plan.model_construct(**{**script_plan.__dict__, "beats": beats})

    gates = claim_gates(plan, brief, storyboard_fixture, composition, registry, 30, 45)
    failed = _failed(gates)
    assert "claims::no_unsupported_facts" in failed or "claims::facts_were_offered" in failed


def test_a_rewritten_caption_is_caught(
    script_plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard_fixture: Storyboard,
    composition: Composition,
    registry: FactRegistry,
):
    rewritten = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"text": "Лучшая платформа"}),
                *composition.captions[1:],
            ]
        }
    )
    gates = claim_gates(script_plan, brief, storyboard_fixture, rewritten, registry, 30, 45)
    assert "captions_are_the_approved_wording" in _failed(gates)


def test_rewritten_narration_is_caught(
    script_plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard_fixture: Storyboard,
    composition: Composition,
    registry: FactRegistry,
):
    scenes = list(storyboard_fixture.scenes)
    scenes[1] = scenes[1].model_construct(
        **{**scenes[1].__dict__, "voiceover": "Совершенно другой текст."}
    )
    storyboard = storyboard_fixture.model_construct(
        **{**storyboard_fixture.__dict__, "scenes": scenes}
    )
    gates = claim_gates(script_plan, brief, storyboard, composition, registry, 30, 45)
    assert "narration_is_the_approved_wording" in _failed(gates)


def test_a_fabricated_fact_reference_is_caught(
    script_plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard_fixture: Storyboard,
    composition: Composition,
    registry: FactRegistry,
):
    scenes = list(storyboard_fixture.scenes)
    scenes[2] = scenes[2].model_construct(**{**scenes[2].__dict__, "source_fact_ids": ["F-404"]})
    storyboard = storyboard_fixture.model_construct(
        **{**storyboard_fixture.__dict__, "scenes": scenes}
    )
    gates = claim_gates(script_plan, brief, storyboard, composition, registry, 30, 45)
    assert "every_cited_fact_exists" in _failed(gates)


def test_placeholder_text_is_caught(
    brief: CreativeBrief, storyboard_fixture: Storyboard, composition: Composition
):
    assert placeholder_gate(brief, storyboard_fixture, composition).passed

    dirty = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"text": "TODO подобрать заголовок"}),
                *composition.captions[1:],
            ]
        }
    )
    assert not placeholder_gate(brief, storyboard_fixture, dirty).passed


# --- the file ----------------------------------------------------------------------


class _StubProbe:
    def __init__(self, info: MediaInfo | Exception) -> None:
        self._info = info

    @property
    def name(self) -> str:
        return "stub"

    def inspect(self, path: Path) -> MediaInfo:
        if isinstance(self._info, Exception):
            raise self._info
        return self._info


def _info(**overrides: object) -> MediaInfo:
    fields: dict[str, object] = {
        "duration_seconds": 40.0,
        "width": 1080,
        "height": 1920,
        "codec": "h264",
        "frame_rate": 30.0,
        "has_video_stream": True,
        "has_audio_stream": True,
        "tool": "stub",
        "video_streams": 1,
        "audio_streams": 1,
        "other_streams": 0,
    }
    fields.update(overrides)
    return MediaInfo(**fields)  # type: ignore[arg-type]


@pytest.fixture
def reel(tmp_path: Path) -> Path:
    path = tmp_path / "maingott_reel.mp4"
    path.write_bytes(b"x" * 5000)
    return path


def test_a_correct_file_passes(reel: Path, composition: Composition):
    gates = file_gates(reel, composition, _StubProbe(_info()), 30, 45)
    assert not _failed(gates), _failed(gates)


def test_a_missing_file_is_caught(tmp_path: Path, composition: Composition):
    gates = file_gates(tmp_path / "absent.mp4", composition, _StubProbe(_info()), 30, 45)
    assert "final_file_exists" in _failed(gates)


def test_an_unreadable_file_is_caught(reel: Path, composition: Composition):
    gates = file_gates(reel, composition, _StubProbe(ProbeError("broken")), 30, 45)
    assert "media_is_readable" in _failed(gates)


def test_a_file_changed_after_composition_is_caught(reel: Path, composition: Composition):
    stamped = composition.model_copy(update={"output_sha256": sha256_text("something else")})
    gates = file_gates(reel, stamped, _StubProbe(_info()), 30, 45)
    assert "final_file_is_unchanged" in _failed(gates)


@pytest.mark.parametrize(
    ("override", "failing"),
    [
        ({"width": 720, "height": 1280}, "resolution_is_correct"),
        ({"width": 1920, "height": 1080}, "aspect_ratio_is_portrait"),
        ({"duration_seconds": 48.0}, "duration_is_within_bounds"),
        ({"duration_seconds": 36.0}, "duration_matches_the_storyboard"),
        ({"frame_rate": 12.0}, "frame_rate_is_correct"),
        ({"video_streams": 2}, "video_stream_exists"),
        ({"has_audio_stream": False, "audio_streams": 0}, "audio_stream_exists"),
        ({"codec": "vp9"}, "video_codec_is_supported"),
    ],
)
def test_technical_faults_are_caught(
    reel: Path, composition: Composition, override: dict[str, object], failing: str
):
    gates = file_gates(reel, composition, _StubProbe(_info(**override)), 30, 45)
    assert failing in _failed(gates)


def test_extra_streams_are_only_a_warning(reel: Path, composition: Composition):
    gates = _named(file_gates(reel, composition, _StubProbe(_info(other_streams=1)), 30, 45))
    assert not gates["no_unexpected_streams"].passed
    assert gates["no_unexpected_streams"].severity is GateSeverity.WARNING
    assert not gates["no_unexpected_streams"].blocking


# --- presentation --------------------------------------------------------------------


def test_captions_inside_the_safe_area_pass(composition: Composition):
    gates = _named(presentation_gates(composition))
    assert gates["captions_are_inside_the_safe_area"].passed
    assert gates["every_caption_was_rendered"].passed


def test_a_caption_outside_the_safe_area_is_caught(composition: Composition, tmp_path: Path):
    bad = _caption_image(tmp_path / "bad.png", composition.settings, inside=False)
    drifted = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"image_path": bad}),
                *composition.captions[1:],
            ]
        }
    )
    assert "captions_are_inside_the_safe_area" in _failed(presentation_gates(drifted))


def test_an_unrendered_caption_is_caught(composition: Composition, tmp_path: Path):
    missing = composition.model_copy(
        update={
            "captions": [
                composition.captions[0].model_copy(update={"image_path": tmp_path / "gone.png"}),
                *composition.captions[1:],
            ]
        }
    )
    assert "every_caption_was_rendered" in _failed(presentation_gates(missing))


def _logo(**overrides: object) -> LogoPlan:
    fields: dict[str, object] = {
        "path": Path("logo.png"),
        "sha256": ZERO,
        "width": 512,
        "height": 128,
        "has_alpha": True,
        "start_seconds": 36.0,
        "end_seconds": 40.0,
        "position_x": 100,
        "position_y": 300,
        "render_width": 454,
    }
    fields.update(overrides)
    return LogoPlan(**fields)  # type: ignore[arg-type]


def test_a_missing_logo_is_only_a_warning(composition: Composition):
    gates = _named(presentation_gates(composition))
    assert not gates["approved_logo_is_applied"].passed
    assert gates["approved_logo_is_applied"].severity is GateSeverity.WARNING


def test_a_readable_logo_passes(composition: Composition, logo_file: Path):
    with_logo = composition.model_copy(update={"logo": _logo(path=logo_file)})
    gates = _named(presentation_gates(with_logo))
    assert gates["logo_is_readable"].passed
    assert gates["logo_is_fully_on_screen"].passed
    assert gates["logo_file_is_present"].passed


def test_a_logo_too_small_to_read_is_caught(composition: Composition, logo_file: Path):
    tiny = composition.model_copy(
        update={"logo": _logo(path=logo_file, render_width=int(1080 * MIN_LOGO_WIDTH_RATIO) - 10)}
    )
    assert "logo_is_readable" in _failed(presentation_gates(tiny))


def test_a_logo_off_the_canvas_is_caught(composition: Composition, logo_file: Path):
    off = composition.model_copy(update={"logo": _logo(path=logo_file, position_x=900)})
    assert "logo_is_fully_on_screen" in _failed(presentation_gates(off))


def test_a_logo_without_transparency_is_a_warning(composition: Composition, logo_file: Path):
    flat = composition.model_copy(update={"logo": _logo(path=logo_file, has_alpha=False)})
    gates = _named(presentation_gates(flat))
    assert not gates["logo_has_transparency"].passed
    assert not gates["logo_has_transparency"].blocking


def test_a_missing_logo_file_is_caught(composition: Composition, tmp_path: Path):
    gone = composition.model_copy(update={"logo": _logo(path=tmp_path / "gone.png")})
    assert "logo_file_is_present" in _failed(presentation_gates(gone))


# --- narration ----------------------------------------------------------------------


@pytest.fixture
def voice_track(tmp_path: Path) -> Path:
    """A real, readable narration track."""
    from maingott_reel.audio.wav import tone_samples, write_wav

    return write_wav(
        tmp_path / "voice.wav", tone_samples(20.0, 24000), sample_rate=24000, channels=1
    )


def _voice_asset(
    path: Path,
    composition: Composition,
    storyboard: Storyboard,
    plan: ScriptPlan,
    **overrides: object,
) -> VoiceAsset:
    from maingott_reel.models import (
        AssetStatus,
        GenerationProvenance,
        SpeechMetrics,
        ValidationCheck,
        ValidationReport,
    )

    fields: dict[str, object] = {
        "id": "voice-abc123def456",
        "status": AssetStatus.READY,
        "created_at": NOW,
        "provider": "openai",
        "model": "gpt-4o-mini-tts",
        "voice": "marin",
        "language": plan.language,
        "cache_key": "b" * 64,
        "narration_sha256": storyboard.narration_sha256,
        "narration_characters": len(plan.narration),
        "storyboard_sha256": composition.storyboard_sha256,
        "target_duration_seconds": 40.0,
        "path": path,
        "sha256": sha256_file(path),
        "size_bytes": path.stat().st_size,
        "duration_seconds": 20.0,
        "sample_rate": 24000,
        "channels": 1,
        "codec": "pcm_s16le",
        "metrics": SpeechMetrics(
            characters=len(plan.narration),
            words=len(plan.narration.split()),
            duration_seconds=20.0,
            timeline_seconds=40.0,
        ),
        "validation": ValidationReport(
            created_at=NOW, checks=[ValidationCheck(name="audio_is_readable", passed=True)]
        ),
        "provenance": GenerationProvenance(
            generator_version="1.0",
            prompt_version="2",
            system_prompt_sha256=ZERO,
            user_prompt_sha256=sha256_text(plan.narration),
            provider="openai",
            model="gpt-4o-mini-tts",
            generated_at=NOW,
            source_sha256=composition.source_sha256,
        ),
    }
    fields.update(overrides)
    return VoiceAsset(**fields)  # type: ignore[arg-type]


def _voiced(composition: Composition, path: Path, voice: VoiceAsset) -> Composition:
    """The same composition, with that narration mixed in."""
    return composition.model_copy(
        update={
            "audio": AudioPlan(
                voice_path=path,
                voice_sha256=sha256_file(path),
                voice_asset_id=voice.id,
                voice_provider=voice.provider,
                voice_model=voice.model,
                voice_name=voice.voice,
                voice_narration_sha256=voice.narration_sha256,
                voice_is_development=voice.development,
                silent=False,
            )
        }
    )


def _voice_gates(
    composition: Composition,
    storyboard: Storyboard,
    plan: ScriptPlan,
    manifest: RunManifest,
    voice: VoiceAsset | None,
) -> dict[str, QualityGate]:
    from maingott_reel.audio.probe import WavProbe

    return _named(
        voice_gates(
            composition=composition,
            storyboard=storyboard,
            plan=plan,
            manifest=manifest,
            voice=voice,
            probe=WavProbe(),
        )
    )


@pytest.fixture
def voiced_manifest(manifest: RunManifest) -> RunManifest:
    manifest.record_stage(StageName.GENERATE_VOICE, completed_at=NOW)
    manifest.files["voice"] = Path("voice.json")
    return manifest


def test_a_silent_reel_is_reported_but_not_blocked(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    manifest: RunManifest,
):
    gates = _voice_gates(composition, storyboard_fixture, script_plan, manifest, None)
    assert not gates["narration_was_generated"].passed
    assert not gates["narration_was_generated"].blocking


def test_a_generated_narration_passes_every_voice_gate(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan)
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not [name for name, gate in gates.items() if not gate.passed], gates
    assert gates["voice_speaks_the_approved_narration"].passed
    assert gates["narration_fits_the_reel"].passed


def test_a_track_generated_from_a_different_script_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(
        voice_track, composition, storyboard_fixture, script_plan, narration_sha256="c" * 64
    )
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["voice_speaks_the_approved_narration"].passed
    assert gates["voice_speaks_the_approved_narration"].blocking


def test_a_reel_mixed_from_another_track_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan)
    mixed = _voiced(composition, voice_track, voice)
    mixed = mixed.model_copy(
        update={"audio": mixed.audio.model_copy(update={"voice_asset_id": "voice-000000000000"})}
    )
    gates = _voice_gates(mixed, storyboard_fixture, script_plan, voiced_manifest, voice)
    assert not gates["the_reel_mixed_that_narration"].passed


def test_narration_from_another_run_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(
        voice_track, composition, storyboard_fixture, script_plan, storyboard_sha256="d" * 64
    )
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["voice_provenance_matches_the_run"].passed


def test_an_untracked_voice_stage_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan)
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        manifest,
        voice,
    )
    assert not gates["voice_is_tracked_in_the_manifest"].passed


def test_a_missing_narration_file_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan)
    mixed = _voiced(composition, voice_track, voice)
    voice_track.unlink()

    gates = _voice_gates(mixed, storyboard_fixture, script_plan, voiced_manifest, voice)
    assert not gates["voice_file_exists"].passed


def test_a_narration_changed_after_composition_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan)
    mixed = _voiced(composition, voice_track, voice)
    voice_track.write_bytes(voice_track.read_bytes() + b"\x00\x00")

    gates = _voice_gates(mixed, storyboard_fixture, script_plan, voiced_manifest, voice)
    assert not gates["voice_file_is_unchanged"].passed
    assert not gates["voice_file_matches_its_record"].passed


def test_unreadable_narration_audio_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    tmp_path: Path,
):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"\x00" * 4096)
    voice = _voice_asset(broken, composition, storyboard_fixture, script_plan)
    gates = _voice_gates(
        _voiced(composition, broken, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["voice_audio_is_readable"].passed


def test_narration_that_would_be_cut_off_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    from maingott_reel.models import SpeechMetrics

    voice = _voice_asset(
        voice_track,
        composition,
        storyboard_fixture,
        script_plan,
        duration_seconds=20.0,
        metrics=SpeechMetrics(
            characters=len(script_plan.narration),
            words=len(script_plan.narration.split()),
            duration_seconds=46.0,
            timeline_seconds=40.0,
        ),
    )
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["narration_fits_the_reel"].passed


def test_an_unmeasured_narration_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(voice_track, composition, storyboard_fixture, script_plan, metrics=None)
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["narration_was_measured"].passed


def test_a_track_recorded_at_a_different_length_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    voice = _voice_asset(
        voice_track, composition, storyboard_fixture, script_plan, duration_seconds=33.0
    )
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["voice_duration_matches_its_record"].passed


def test_narration_in_the_wrong_language_is_caught(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    voiced_manifest: RunManifest,
    voice_track: Path,
):
    from maingott_reel.models import Language

    voice = _voice_asset(
        voice_track, composition, storyboard_fixture, script_plan, language=Language.EN
    )
    gates = _voice_gates(
        _voiced(composition, voice_track, voice),
        storyboard_fixture,
        script_plan,
        voiced_manifest,
        voice,
    )
    assert not gates["voice_language_matches_the_plan"].passed


def test_an_externally_approved_track_is_checked_but_not_audited(
    composition: Composition,
    storyboard_fixture: Storyboard,
    script_plan: ScriptPlan,
    manifest: RunManifest,
    voice_track: Path,
):
    mixed = composition.model_copy(
        update={
            "audio": AudioPlan(
                voice_path=voice_track, voice_sha256=sha256_file(voice_track), silent=False
            )
        }
    )
    gates = _voice_gates(mixed, storyboard_fixture, script_plan, manifest, None)

    assert gates["narration_was_generated"].passed
    assert "outside the pipeline" in (gates["narration_was_generated"].detail or "")
    assert gates["voice_file_is_unchanged"].passed
    assert "voice_speaks_the_approved_narration" not in gates


# --- readiness ---------------------------------------------------------------------


def test_readiness_reports_a_development_reel(composition: Composition):
    gates = _named(readiness_gates(composition))
    assert not gates["narration_is_present"].passed
    assert not gates["brand_mark_is_present"].passed
    assert not gates["not_a_development_output"].passed
    assert all(not gate.blocking for gate in gates.values())


def test_readiness_passes_for_a_production_reel(
    composition: Composition, logo_file: Path, tmp_path: Path
):
    voice = tmp_path / "voice.wav"
    voice.write_bytes(b"audio")
    production = composition.model_copy(
        update={
            "audio": AudioPlan(voice_path=voice, voice_sha256=ZERO, silent=False),
            "logo": _logo(path=logo_file),
            "development": False,
        }
    )
    assert not _failed(readiness_gates(production))


def test_readiness_reports_a_placeholder_voice(composition: Composition, tmp_path: Path):
    voice = tmp_path / "voice.wav"
    voice.write_bytes(b"audio")
    development = composition.model_copy(
        update={
            "audio": AudioPlan(
                voice_path=voice, voice_sha256=ZERO, silent=False, voice_is_development=True
            )
        }
    )
    gates = _named(readiness_gates(development))
    assert gates["narration_is_present"].passed
    assert not gates["narration_is_a_production_voice"].passed
    assert not gates["narration_is_a_production_voice"].blocking


# --- the report ---------------------------------------------------------------------


def test_a_report_separates_blocking_failures_from_warnings():
    report = QualityReport(
        created_at=NOW,
        run_id="run-1",
        gates=[
            QualityGate(name="ok", group=GateGroup.FILE, passed=True),
            QualityGate(
                name="warn", group=GateGroup.READINESS, passed=False, severity=GateSeverity.WARNING
            ),
        ],
    )
    assert report.passed
    assert not report.production_ready
    assert [gate.name for gate in report.warnings] == ["warn"]
    assert report.blocking_failures == []
    assert "1/2 gates passed" in report.summary()


def test_a_blocking_failure_fails_the_report():
    report = QualityReport(
        created_at=NOW,
        run_id="run-1",
        gates=[QualityGate(name="bad", group=GateGroup.FILE, passed=False)],
    )
    assert not report.passed
    assert not report.production_ready
    assert [gate.name for gate in report.blocking_failures] == ["bad"]


def test_an_empty_report_does_not_pass():
    assert not QualityReport(created_at=NOW, run_id="run-1").passed


def test_gates_can_be_read_by_group():
    report = QualityReport(
        created_at=NOW,
        run_id="run-1",
        gates=[
            QualityGate(name="a", group=GateGroup.FILE, passed=True),
            QualityGate(name="b", group=GateGroup.CLAIMS, passed=True),
        ],
    )
    assert [gate.name for gate in report.by_group(GateGroup.FILE)] == ["a"]
