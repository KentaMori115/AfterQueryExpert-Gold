"""The validate stage, end to end on a composed run."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.audit.auditor import audit
from maingott_reel.config import Settings
from maingott_reel.errors import RunNotFoundError, StageNotCompletedError
from maingott_reel.models import QualityReport, RunManifest, StageName
from maingott_reel.utils.jsonio import read_model
from maingott_reel.utils.run_context import RunContext, create_run
from maingott_reel.video.composition import compose


@pytest.fixture
def audited_run(compose_settings: Settings, composed_run: RunContext) -> RunContext:
    """A run that has been composed as a development Reel."""
    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    return composed_run


def test_a_finished_development_run_passes_every_blocking_gate(
    compose_settings: Settings, audited_run: RunContext
):
    result = audit(compose_settings, run_id=audited_run.run_id)

    assert result.passed, [gate.name for gate in result.report.blocking_failures]
    assert not result.production_ready
    assert result.report.warnings
    assert len(result.report.gates) > 40


def test_strict_mode_refuses_a_development_reel(
    compose_settings: Settings, audited_run: RunContext
):
    result = audit(compose_settings, run_id=audited_run.run_id, strict=True)
    assert not result.passed
    assert result.report.passed, "the blocking gates still pass"


def test_a_production_run_is_production_ready(
    compose_settings: Settings,
    composed_run: RunContext,
    silent_voice_track: Path,
    logo_file: Path,
):
    settings = compose_settings.model_copy(update={"brand_logo": logo_file})
    compose(settings, run_id=composed_run.run_id, voice=silent_voice_track)

    result = audit(settings, run_id=composed_run.run_id, strict=True)

    assert result.passed
    assert result.production_ready
    assert not result.report.failures


@pytest.fixture
def voiced_run(compose_settings: Settings, composed_run: RunContext) -> RunContext:
    """A run narrated by the offline provider and composed with that track."""
    from maingott_reel.audio.voice import generate_voice

    assert generate_voice(compose_settings, run_id=composed_run.run_id, offline=True).complete
    compose(compose_settings, run_id=composed_run.run_id, no_logo=True)
    return composed_run


def test_a_narrated_run_is_audited_against_its_voice(
    compose_settings: Settings, voiced_run: RunContext
):
    result = audit(compose_settings, run_id=voiced_run.run_id)

    assert result.passed, [gate.name for gate in result.report.blocking_failures]
    from maingott_reel.models import GateGroup

    voice_gates = {gate.name: gate for gate in result.report.by_group(GateGroup.VOICE)}
    assert voice_gates["voice_speaks_the_approved_narration"].passed
    assert voice_gates["the_reel_mixed_that_narration"].passed
    assert voice_gates["voice_is_tracked_in_the_manifest"].passed
    assert voice_gates["narration_fits_the_reel"].passed


def test_a_placeholder_voice_is_still_not_production_ready(
    compose_settings: Settings, voiced_run: RunContext
):
    result = audit(compose_settings, run_id=voiced_run.run_id, strict=True)

    assert result.report.passed, "the blocking gates still pass"
    assert not result.passed
    assert "narration_is_a_production_voice" in {gate.name for gate in result.report.warnings}


def test_a_tampered_narration_fails_the_audit(compose_settings: Settings, voiced_run: RunContext):
    from maingott_reel.models import VoiceAsset

    voice = read_model(voiced_run.voice_json, VoiceAsset)
    assert voice.path is not None
    voice.path.write_bytes(voice.path.read_bytes() + b"\x00\x00")

    result = audit(compose_settings, run_id=voiced_run.run_id)

    assert not result.passed
    assert "voice_file_is_unchanged" in {gate.name for gate in result.report.blocking_failures}


def test_a_voice_record_from_another_script_fails_the_audit(
    compose_settings: Settings, voiced_run: RunContext
):
    from maingott_reel.models import VoiceAsset
    from maingott_reel.utils.jsonio import write_model

    voice = read_model(voiced_run.voice_json, VoiceAsset)
    write_model(voiced_run.voice_json, voice.model_copy(update={"narration_sha256": "c" * 64}))

    result = audit(compose_settings, run_id=voiced_run.run_id)

    assert not result.passed
    failures = {gate.name for gate in result.report.blocking_failures}
    assert "voice_speaks_the_approved_narration" in failures


def test_an_unreadable_voice_record_is_reported(compose_settings: Settings, voiced_run: RunContext):
    voiced_run.voice_json.write_text("{not json", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match=r"voice\.json"):
        audit(compose_settings, run_id=voiced_run.run_id)


def test_the_report_and_manifest_are_written(compose_settings: Settings, audited_run: RunContext):
    result = audit(compose_settings, run_id=audited_run.run_id)

    stored = read_model(audited_run.validation_json, QualityReport)
    assert stored.run_id == audited_run.run_id
    assert len(stored.gates) == len(result.report.gates)

    manifest = read_model(audited_run.manifest_json, RunManifest)
    assert manifest.stage_completed(StageName.VALIDATE)
    assert manifest.quality is not None
    assert manifest.quality.passed
    assert "validation" in manifest.files


def test_a_deleted_reel_fails_the_audit(compose_settings: Settings, audited_run: RunContext):
    audited_run.final_video.unlink()
    result = audit(compose_settings, run_id=audited_run.run_id)

    assert not result.passed
    assert "final_file_exists" in {gate.name for gate in result.report.blocking_failures}


def test_a_tampered_reel_fails_the_audit(compose_settings: Settings, audited_run: RunContext):
    audited_run.final_video.write_bytes(audited_run.final_video.read_bytes() + b"extra")
    result = audit(compose_settings, run_id=audited_run.run_id)

    failing = {gate.name for gate in result.report.blocking_failures}
    assert not result.passed
    assert "final_file_is_unchanged" in failing


def test_a_deleted_asset_fails_the_audit(compose_settings: Settings, audited_run: RunContext):
    from maingott_reel.models import AssetCollection

    assets = read_model(audited_run.assets_json, AssetCollection)
    path = assets.assets[0].path
    assert path is not None
    path.unlink()

    result = audit(compose_settings, run_id=audited_run.run_id)
    assert not result.passed
    assert "asset_files_are_present" in {gate.name for gate in result.report.blocking_failures}


def test_an_edited_storyboard_fails_the_audit(compose_settings: Settings, audited_run: RunContext):
    audited_run.storyboard_json.write_text(
        audited_run.storyboard_json.read_text() + "\n", encoding="utf-8"
    )
    result = audit(compose_settings, run_id=audited_run.run_id)

    failing = {gate.name for gate in result.report.blocking_failures}
    assert not result.passed
    assert "assets_match_the_storyboard" in failing


def test_the_audit_reads_the_file_back_with_ffprobe(
    compose_settings: Settings, audited_run: RunContext
):
    result = audit(compose_settings, run_id=audited_run.run_id)
    detail = {gate.name: gate.detail for gate in result.report.gates}

    assert detail["media_is_readable"] == "inspected with ffprobe"
    assert detail["resolution_is_correct"].startswith("540x960")
    assert "1 video streams" in detail["video_stream_exists"]
    assert "1 audio streams" in detail["audio_stream_exists"]


def test_auditing_without_a_run_fails(compose_settings: Settings):
    with pytest.raises(RunNotFoundError):
        audit(compose_settings)


def test_auditing_an_uncomposed_run_fails(compose_settings: Settings, composed_run: RunContext):
    with pytest.raises(StageNotCompletedError, match="compose"):
        audit(compose_settings, run_id=composed_run.run_id)


def test_auditing_a_run_without_a_manifest_fails(
    compose_settings: Settings, audited_run: RunContext
):
    audited_run.manifest_json.unlink()
    with pytest.raises(StageNotCompletedError, match="manifest"):
        audit(compose_settings, run_id=audited_run.run_id)


def test_unreadable_artifacts_are_reported(compose_settings: Settings, audited_run: RunContext):
    audited_run.composition_json.write_text("{ broken", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match="unreadable"):
        audit(compose_settings, run_id=audited_run.run_id)


def test_an_empty_run_directory_fails(compose_settings: Settings):
    run = create_run(compose_settings, run_id="bare")
    with pytest.raises(StageNotCompletedError):
        audit(compose_settings, run_id=run.run_id)
