"""Pydantic schema foundation."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from maingott_reel.models import (
    Asset,
    AssetCollection,
    AssetRequirement,
    AssetStatus,
    AssetType,
    AudioPlan,
    BeatKind,
    CaptionCue,
    ClaimReference,
    ClaimStatus,
    Composition,
    CompositionSettings,
    CostEstimate,
    CreativeBrief,
    DurationStrategy,
    Fact,
    FactRegistry,
    FontInfo,
    GenerationProvenance,
    RunManifest,
    SafeArea,
    ScaleCrop,
    Scene,
    ScriptBeat,
    ScriptPlan,
    SourceBlock,
    SourceDocument,
    StageName,
    Storyboard,
    TimelineScene,
    ValidationCheck,
    ValidationReport,
)

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO_HASH = "0" * 64
ONE_HASH = "1" * 64


def _claim(fact_ids: list[str]) -> ClaimReference:
    return ClaimReference(
        claim="MainGott объединяет каналы в одну систему.", source_fact_ids=fact_ids
    )


def _beat(order: int, kind: BeatKind, claims: list[ClaimReference]) -> ScriptBeat:
    return ScriptBeat(
        id=f"B-{order:02d}",
        order=order,
        kind=kind,
        purpose="показать систему",
        narration=f"Строка {order}.",
        on_screen_text="MAINGOTT",
        visual_direction="тёмная премиальная сцена",
        estimated_seconds=20.0,
        claims=claims,
    )


def _plan(**overrides: object) -> ScriptPlan:
    beats = overrides.pop("beats", None) or [
        _beat(1, BeatKind.FRAMING, claims=[]),
        _beat(2, BeatKind.FACTUAL, claims=[_claim(["F-001"])]),
    ]
    fields: dict[str, object] = {
        "created_at": NOW,
        "target_duration_seconds": 40,
        "total_estimated_seconds": round(sum(b.estimated_seconds for b in beats), 2),
        "narration": "\n".join(b.narration for b in beats),
        "beats": beats,
        "source_fact_ids": [f for b in beats for f in b.source_fact_ids],
        "claims": [c for b in beats for c in b.claims],
        "validation": ValidationReport(
            created_at=NOW, checks=[ValidationCheck(name="facts_exist", passed=True)]
        ),
        "provenance": GenerationProvenance(
            generator_version="1.0",
            prompt_version="1/1",
            system_prompt_sha256=ZERO_HASH,
            user_prompt_sha256=ZERO_HASH,
            provider="fake",
            model="scripted",
            generated_at=NOW,
            source_sha256=ZERO_HASH,
        ),
    }
    fields.update(overrides)
    return ScriptPlan(**fields)  # type: ignore[arg-type]


def _scene(index: int, start: float, duration: float) -> Scene:
    return Scene(
        id=f"S-{index:02d}",
        beat_id=f"B-{index:02d}",
        start_seconds=start,
        duration_seconds=duration,
        purpose="reveal",
        visual_description="dark premium data flow",
        video_prompt="cinematic dark UI with connected channels",
        overlay_text="One connected system.",
    )


# --- base behaviour -----------------------------------------------------


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        Fact(id="F-001", statement="A statement.", unexpected="x")


# --- source -------------------------------------------------------------


def test_fact_id_must_follow_the_convention():
    with pytest.raises(ValidationError):
        Fact(id="fact-1", statement="A statement.")


def test_unsupported_facts_are_not_usable_in_advertising():
    supported = Fact(id="F-001", statement="MainGott unifies channels.")
    target = Fact(id="F-002", statement="Target response time.", claim_status=ClaimStatus.TARGET)
    unsupported = Fact(
        id="F-003", statement="Ten thousand customers.", claim_status=ClaimStatus.UNSUPPORTED
    )
    assert supported.usable_in_advertising
    assert target.usable_in_advertising
    assert not unsupported.usable_in_advertising


def test_fact_registry_rejects_duplicate_ids():
    with pytest.raises(ValidationError, match="duplicate fact ids"):
        FactRegistry(
            source_sha256=ZERO_HASH,
            created_at=NOW,
            facts=[Fact(id="F-001", statement="One."), Fact(id="F-001", statement="Two.")],
        )


def test_fact_registry_lookup_and_unknown_ids():
    registry = FactRegistry(
        source_sha256=ZERO_HASH,
        created_at=NOW,
        facts=[Fact(id="F-001", statement="MainGott unifies channels.")],
    )
    assert registry.get("F-001") is not None
    assert registry.get("F-404") is None
    assert registry.unknown_ids(["F-001", "F-404"]) == ["F-404"]


def test_source_document_block_count_must_match():
    block = SourceBlock(index=0, line=1, text="MainGott Sales & Operations OS")
    with pytest.raises(ValidationError, match="block_count"):
        SourceDocument(
            path=Path("input/source/spec.docx"),
            sha256=ZERO_HASH,
            extracted_at=NOW,
            block_count=5,
            blocks=[block],
        )


def test_source_document_requires_a_real_hash():
    with pytest.raises(ValidationError):
        SourceDocument(path=Path("spec.docx"), sha256="not-a-hash", extracted_at=NOW, block_count=0)


# --- creative -----------------------------------------------------------


def test_creative_brief_enforces_the_duration_window():
    with pytest.raises(ValidationError):
        CreativeBrief(
            objective="Advertise the MainGott platform.",
            audience="business decision makers",
            target_duration_seconds=60,
            tone="calm and confident",
            visual_direction="dark premium environment",
            core_message="One connected system.",
            cta="maingott",
        )


def test_claim_reference_requires_at_least_one_fact():
    with pytest.raises(ValidationError):
        ClaimReference(claim="MainGott connects channels.", source_fact_ids=[])


def test_claim_reference_rejects_blank_and_duplicate_fact_ids():
    with pytest.raises(ValidationError, match="empty ids"):
        ClaimReference(claim="MainGott connects channels.", source_fact_ids=["  "])
    with pytest.raises(ValidationError, match="repeat"):
        ClaimReference(claim="MainGott connects channels.", source_fact_ids=["F-001", "F-001"])


def test_factual_beat_must_cite_a_fact():
    with pytest.raises(ValidationError, match="must cite at least one fact"):
        _beat(1, BeatKind.FACTUAL, claims=[])


def test_framing_beat_must_not_carry_claims():
    with pytest.raises(ValidationError, match="must not carry factual claims"):
        _beat(1, BeatKind.FRAMING, claims=[_claim(["F-001"])])


def test_beat_collects_its_fact_ids_in_order():
    beat = _beat(
        1, BeatKind.FACTUAL, claims=[_claim(["F-002", "F-001"]), _claim(["F-001", "F-003"])]
    )
    assert beat.source_fact_ids == ["F-002", "F-001", "F-003"]


def test_valid_script_plan_is_accepted():
    plan = _plan()
    assert plan.beat_count == 2
    assert plan.passed
    assert plan.source_fact_ids == ["F-001"]
    assert plan.narration.splitlines() == [beat.narration for beat in plan.beats]


def test_script_plan_rejects_inconsistent_totals():
    with pytest.raises(ValidationError, match="total_estimated_seconds"):
        _plan(total_estimated_seconds=39.0)


def test_script_plan_rejects_fact_ids_that_do_not_match_the_beats():
    with pytest.raises(ValidationError, match="source_fact_ids"):
        _plan(source_fact_ids=["F-001", "F-999"])


def test_script_plan_rejects_claims_that_do_not_mirror_the_beats():
    with pytest.raises(ValidationError, match="claims must mirror"):
        _plan(claims=[])


def test_script_plan_rejects_narration_that_does_not_match_the_beats():
    with pytest.raises(ValidationError, match="narration must be"):
        _plan(narration="Совсем другой текст.")


def test_script_plan_rejects_unordered_beats():
    beats = [_beat(2, BeatKind.FRAMING, claims=[]), _beat(1, BeatKind.FRAMING, claims=[])]
    with pytest.raises(ValidationError, match="ascending"):
        _plan(beats=beats)


# --- storyboard ---------------------------------------------------------


def _storyboard(**overrides: object) -> Storyboard:
    scenes = overrides.pop("scenes", None) or [_scene(1, 0, 20), _scene(2, 20, 20)]
    fields: dict[str, object] = {
        "created_at": NOW,
        "target_duration_seconds": 40,
        "total_duration_seconds": round(sum(s.duration_seconds for s in scenes), 2),
        "narration_sha256": ZERO_HASH,
        "scenes": scenes,
        "source_fact_ids": [f for s in scenes for f in s.source_fact_ids],
        "validation": ValidationReport(
            created_at=NOW, checks=[ValidationCheck(name="timeline_is_contiguous", passed=True)]
        ),
        "provenance": GenerationProvenance(
            generator_version="1.0",
            prompt_version="1/3",
            system_prompt_sha256=ZERO_HASH,
            user_prompt_sha256=ZERO_HASH,
            provider="fake",
            model="offline-planner",
            generated_at=NOW,
            source_sha256=ZERO_HASH,
        ),
    }
    fields.update(overrides)
    return Storyboard(**fields)  # type: ignore[arg-type]


def test_storyboard_accepts_a_contiguous_timeline():
    board = _storyboard()
    assert board.scenes[1].end_seconds == 40
    assert board.scene_count == 2
    assert board.passed


def test_storyboard_rejects_gaps_between_scenes():
    with pytest.raises(ValidationError, match="previous scene ends"):
        _storyboard(scenes=[_scene(1, 0, 15), _scene(2, 20, 20)], total_duration_seconds=35)


def test_storyboard_rejects_a_total_that_does_not_match_the_scenes():
    with pytest.raises(ValidationError, match="total_duration_seconds"):
        _storyboard(total_duration_seconds=45)


def test_storyboard_rejects_a_duration_outside_the_brief():
    with pytest.raises(ValidationError):
        _storyboard(scenes=[_scene(1, 0, 20)])


def test_storyboard_rejects_two_scenes_for_one_beat():
    second = _scene(2, 20, 20).model_construct(**{**_scene(2, 20, 20).__dict__, "beat_id": "B-01"})
    with pytest.raises(ValidationError, match="only one scene"):
        _storyboard(scenes=[_scene(1, 0, 20), second])


def test_storyboard_rejects_fact_ids_that_do_not_match_the_scenes():
    with pytest.raises(ValidationError, match="source_fact_ids"):
        _storyboard(source_fact_ids=["F-404"])


def test_storyboard_collects_referenced_fact_ids_in_order():
    first = _scene(1, 0, 20).model_copy(update={"source_fact_ids": ["F-002", "F-001"]})
    second = _scene(2, 20, 20).model_copy(update={"source_fact_ids": ["F-001", "F-003"]})
    board = _storyboard(scenes=[first, second], source_fact_ids=["F-002", "F-001", "F-003"])
    assert board.fact_ids == ["F-002", "F-001", "F-003"]


def test_storyboard_lists_every_asset_requirement():
    scene = _scene(1, 0, 20).model_copy(
        update={
            "asset_requirements": [
                AssetRequirement(
                    asset_type=AssetType.VIDEO, prompt="a dark room", duration_seconds=20
                )
            ]
        }
    )
    board = _storyboard(scenes=[scene, _scene(2, 20, 20)])
    assert len(board.asset_requirements()) == 1


# --- assets -------------------------------------------------------------


def test_ready_asset_requires_path_and_hash():
    with pytest.raises(ValidationError, match="no path"):
        Asset(id="a1", asset_type=AssetType.VIDEO, status=AssetStatus.READY)


def test_failed_asset_requires_an_error_message():
    with pytest.raises(ValidationError, match="no error message"):
        Asset(id="a1", asset_type=AssetType.VIDEO, status=AssetStatus.FAILED)


def test_validation_report_passes_only_when_every_check_passes():
    passing = ValidationReport(
        created_at=NOW, checks=[ValidationCheck(name="duration", passed=True)]
    )
    failing = ValidationReport(
        created_at=NOW,
        checks=[
            ValidationCheck(name="duration", passed=True),
            ValidationCheck(name="portrait", passed=False, detail="1920x1080"),
        ],
    )
    empty = ValidationReport(created_at=NOW)
    assert passing.passed
    assert not failing.passed
    assert [check.name for check in failing.failures] == ["portrait"]
    assert not empty.passed


def test_manifest_records_stages_idempotently():
    manifest = RunManifest(run_id="run-a", created_at=NOW, app_version="0.1.0")
    assert not manifest.stage_completed(StageName.ANALYZE)
    manifest.record_stage(StageName.ANALYZE, NOW, artifact=Path("facts.json"))
    manifest.record_stage(StageName.ANALYZE, NOW, notes="re-run")
    assert manifest.stage_completed(StageName.ANALYZE)
    assert len(manifest.stages) == 1
    assert manifest.stages[0].notes == "re-run"
    assert manifest.updated_at == NOW


def test_cost_estimate_totals():
    assert CostEstimate(text_usd=0.5, video_usd=1.25).total_usd == 1.75


def test_composition_settings_reject_an_unsafe_caption_margin():
    with pytest.raises(ValidationError):
        CompositionSettings(width=1080, height=1920, fps=30, caption_safe_margin_ratio=0.9)


def test_storyboard_rejects_duplicate_scene_ids():
    duplicate = _scene(2, 20, 20).model_construct(**{**_scene(2, 20, 20).__dict__, "id": "S-01"})
    with pytest.raises(ValidationError, match="scene ids must be unique"):
        _storyboard(scenes=[_scene(1, 0, 20), duplicate])


def test_fact_rejects_negative_source_lines():
    with pytest.raises(ValidationError, match="source_lines"):
        Fact(id="F-001", statement="A statement.", source_lines=[-1])


def test_ready_asset_requires_a_hash():
    with pytest.raises(ValidationError, match="no sha256"):
        Asset(
            id="a1",
            asset_type=AssetType.VIDEO,
            status=AssetStatus.READY,
            path=Path("assets/a1.mp4"),
        )


def test_source_document_without_blocks_keeps_its_declared_count():
    document = SourceDocument(
        path=Path("spec.docx"), sha256=ZERO_HASH, extracted_at=NOW, block_count=12
    )
    assert document.block_count == 12


def test_table_blocks_require_table_coordinates():
    with pytest.raises(ValidationError, match="table_index and row_index"):
        SourceBlock(index=0, line=1, text="Показатель — Целевое значение", block_type="table_row")


def test_non_table_blocks_reject_table_coordinates():
    with pytest.raises(ValidationError, match="table_index and row_index"):
        SourceBlock(index=0, line=1, text="Обычный абзац.", table_index=0, row_index=0)


def test_script_plan_rejects_duplicate_beat_ids():
    first = _beat(1, BeatKind.FRAMING, claims=[])
    second = _beat(2, BeatKind.FRAMING, claims=[]).model_construct(
        **{**_beat(2, BeatKind.FRAMING, claims=[]).__dict__, "id": "B-01"}
    )
    with pytest.raises(ValidationError, match="beat ids must be unique"):
        _plan(beats=[first, second])


# --- assets (Phase 4 fields) ---------------------------------------------


def _asset(**overrides: object) -> Asset:
    fields: dict[str, object] = {
        "id": "S-01-video-abc123def456",
        "asset_type": AssetType.VIDEO,
        "status": AssetStatus.READY,
        "scene_id": "S-01",
        "beat_id": "B-01",
        "path": Path("assets/scene_01/video.mp4"),
        "sha256": ONE_HASH,
    }
    fields.update(overrides)
    return Asset(**fields)  # type: ignore[arg-type]


def test_a_ready_asset_that_failed_validation_is_rejected():
    failing = ValidationReport(
        created_at=NOW, checks=[ValidationCheck(name="file_exists", passed=False)]
    )
    with pytest.raises(ValidationError, match="failed validation"):
        _asset(validation=failing)


def test_a_ready_asset_carries_its_provenance():
    asset = _asset(
        provider="openai",
        model="sora-2",
        prompt_hash=ZERO_HASH,
        cache_key=ONE_HASH,
        requested_duration_seconds=3.83,
        generated_duration_seconds=4.0,
        duration_strategy=DurationStrategy.TRIM_IN_POST,
    )
    assert asset.is_usable
    assert asset.duration_strategy is DurationStrategy.TRIM_IN_POST


def test_an_asset_collection_summarises_its_state():
    ready = _asset()
    cached = _asset(id="S-02-video-abc", scene_id="S-02", status=AssetStatus.CACHED, cache_hit=True)
    failed = _asset(
        id="S-03-video-abc",
        scene_id="S-03",
        status=AssetStatus.FAILED,
        path=None,
        sha256=None,
        error="the model refused",
    )
    collection = AssetCollection(
        created_at=NOW,
        source_sha256=ZERO_HASH,
        storyboard_sha256=ONE_HASH,
        narration_sha256=ZERO_HASH,
        provider="fake",
        model="offline-video",
        assets=[ready, cached, failed],
    )

    assert collection.ready == [ready, cached]
    assert collection.failed == [failed]
    assert collection.pending == [failed]
    assert collection.cache_hits == 1
    assert collection.complete is False
    assert collection.for_scene("S-02") is cached
    assert collection.get("S-01-video-abc123def456") is ready
    assert collection.by_type(AssetType.VIDEO) == [ready, cached, failed]


def test_two_assets_for_one_scene_are_rejected():
    with pytest.raises(ValidationError, match="only one asset"):
        AssetCollection(
            created_at=NOW,
            source_sha256=ZERO_HASH,
            storyboard_sha256=ONE_HASH,
            narration_sha256=ZERO_HASH,
            provider="fake",
            model="offline-video",
            assets=[_asset(), _asset(id="S-01-video-other")],
        )


def test_a_complete_collection_reports_complete():
    collection = AssetCollection(
        created_at=NOW,
        source_sha256=ZERO_HASH,
        storyboard_sha256=ONE_HASH,
        narration_sha256=ZERO_HASH,
        provider="fake",
        model="offline-video",
        assets=[_asset()],
    )
    assert collection.complete


# --- composition ----------------------------------------------------------


def _timeline_scene(index: int, start: float, duration: float) -> TimelineScene:
    return TimelineScene(
        scene_id=f"S-{index:02d}",
        beat_id=f"B-{index:02d}",
        order=index,
        asset_id=f"S-{index:02d}-video-abc",
        source_path=Path("assets/scene.mp4"),
        source_duration_seconds=12.0,
        trim_duration_seconds=duration,
        start_seconds=start,
        duration_seconds=duration,
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


def _composition(**overrides: object) -> Composition:
    scenes = overrides.pop("scenes", None) or [
        _timeline_scene(1, 0.0, 20.0),
        _timeline_scene(2, 20.0, 20.0),
    ]
    fields: dict[str, object] = {
        "created_at": NOW,
        "run_id": "run-1",
        "target_duration_seconds": 40,
        "timeline_duration_seconds": round(sum(s.duration_seconds for s in scenes), 2),
        "settings": CompositionSettings(),
        "scenes": scenes,
        "audio": AudioPlan(silent=True),
        "font": FontInfo(family="DejaVuSans", path=Path("font.ttf"), sha256=ZERO_HASH),
        "source_sha256": ZERO_HASH,
        "storyboard_sha256": ZERO_HASH,
        "narration_sha256": ZERO_HASH,
        "assets_sha256": ZERO_HASH,
        "composition_sha256": ZERO_HASH,
    }
    fields.update(overrides)
    return Composition(**fields)  # type: ignore[arg-type]


def test_a_composition_timeline_must_be_contiguous():
    with pytest.raises(ValidationError, match="expected"):
        _composition(scenes=[_timeline_scene(1, 0.0, 20.0), _timeline_scene(2, 25.0, 15.0)])


def test_a_composition_total_must_match_its_scenes():
    with pytest.raises(ValidationError, match="timeline"):
        _composition(timeline_duration_seconds=45.0)


def test_a_caption_cannot_run_past_the_timeline():
    cue = CaptionCue(
        id="C-01", scene_id="S-01", text="Разные каналы", start_seconds=0.0, end_seconds=45.0
    )
    with pytest.raises(ValidationError, match="past the end"):
        _composition(captions=[cue])


def test_a_caption_must_end_after_it_starts():
    with pytest.raises(ValidationError, match="ends before it starts"):
        CaptionCue(id="C-01", scene_id="S-01", text="Текст", start_seconds=5.0, end_seconds=5.0)


def test_a_safe_area_margin_cannot_take_half_the_frame():
    with pytest.raises(ValidationError):
        SafeArea(top=0.5)
    assert SafeArea(top=0.49, bottom=0.49).box(1080, 1920)[3] > 0


def test_the_safe_area_box_is_in_pixels():
    left, top, right, bottom = SafeArea(top=0.1, bottom=0.2, left=0.05, right=0.05).box(1080, 1920)
    assert (left, top, right, bottom) == (54, 192, 1026, 1536)


def test_scale_crop_reports_an_upscale():
    geometry = _timeline_scene(1, 0.0, 20.0).geometry
    assert geometry.is_upscale


def test_composition_reports_its_shape():
    composition = _composition()
    assert composition.scene_count == 2
    assert not composition.passed
    assert composition.settings.is_portrait
    assert composition.scenes[0].end_seconds == 20.0
