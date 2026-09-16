"""Production readiness: the release-check stage."""

from __future__ import annotations

from pathlib import Path

import pytest
from tests.conftest import write_brand_registry, write_voice_profile

from maingott_reel.config import Settings
from maingott_reel.errors import StageNotCompletedError
from maingott_reel.models import (
    AssetCollection,
    Composition,
    ReleaseOutcome,
    ReleaseState,
    RunManifest,
    VoiceAsset,
)
from maingott_reel.release.checker import release_check
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext


def _gates(result) -> dict[str, object]:
    return {gate.name: gate for gate in result.report.gates}


# --- a development run ---------------------------------------------------------


def test_a_development_run_is_blocked(compose_settings: Settings, composed_run: RunContext):
    from maingott_reel.video.composition import compose

    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)

    result = release_check(compose_settings, run_id=composed_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not result.is_release_candidate
    assert result.state is ReleaseState.VALIDATED
    gates = _gates(result)
    assert not gates["not_a_development_composition"].passed
    assert not gates["footage_came_from_a_real_provider"].passed
    assert not gates["narration_is_present"].passed
    assert not gates["approved_logo_is_applied"].passed


def test_an_offline_voice_is_blocked(
    compose_settings: Settings, composed_run: RunContext, logo_file: Path
):
    from maingott_reel.audio.voice import generate_voice
    from maingott_reel.video.composition import compose

    settings = compose_settings.model_copy(update={"brand_logo": logo_file})
    write_brand_registry(settings, logo=logo_file)
    write_voice_profile(settings)
    generate_voice(settings, run_id=composed_run.run_id, offline=True)
    compose(settings, run_id=composed_run.run_id)

    result = release_check(settings, run_id=composed_run.run_id)

    gates = _gates(result)
    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not gates["narration_came_from_a_real_provider"].passed
    assert not gates["narration_voice_is_approved"].passed


# --- a production run -----------------------------------------------------------


def test_a_production_run_is_a_release_candidate(
    production_settings: Settings, production_run: RunContext
):
    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.PASS, [gate.name for gate in result.blocking]
    assert result.is_release_candidate
    assert result.state is ReleaseState.RELEASE_CANDIDATE
    assert result.fingerprint.release_id.startswith("rel-")


def test_the_configuration_snapshot_is_written(
    production_settings: Settings, production_run: RunContext
):
    result = release_check(production_settings, run_id=production_run.run_id)

    assert production_run.configuration_json.is_file()
    manifest = read_model(production_run.manifest_json, RunManifest)
    assert manifest.files["configuration"] == production_run.configuration_json
    assert manifest.release_state is result.state


def test_a_missing_brand_registry_blocks_release(
    production_settings: Settings, production_run: RunContext
):
    production_settings.brand_registry_path.unlink()

    result = release_check(production_settings, run_id=production_run.run_id)

    gates = _gates(result)
    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not gates["brand_registry_exists"].passed
    assert not gates["approved_logo_is_applied"].passed


def test_an_unapproved_logo_blocks_release(
    production_settings: Settings, production_run: RunContext, logo_file: Path
):
    write_brand_registry(production_settings, logo=logo_file, approved=False)

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not _gates(result)["approved_logo_is_applied"].passed


def test_an_unapproved_voice_blocks_release(
    production_settings: Settings, production_run: RunContext
):
    write_voice_profile(production_settings, approved=False)

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert "not marked approved" in (_gates(result)["narration_voice_is_approved"].detail or "")


def test_a_different_voice_than_the_approved_one_blocks_release(
    production_settings: Settings, production_run: RunContext
):
    write_voice_profile(production_settings, voice="cedar")

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    detail = _gates(result)["narration_voice_is_approved"].detail or ""
    assert "approved is" in detail


def test_a_missing_voice_profile_blocks_release(
    production_settings: Settings, production_run: RunContext
):
    production_settings.voice_profile_path.unlink()

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert "no voice profile" in (_gates(result)["narration_voice_is_approved"].detail or "")


def test_offline_footage_blocks_release(production_settings: Settings, production_run: RunContext):
    collection = read_model(production_run.assets_json, AssetCollection)
    write_model(
        production_run.assets_json,
        collection.model_copy(update={"provider": "fake", "model": "offline-video"}),
    )

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not _gates(result)["footage_came_from_a_real_provider"].passed


def test_a_failing_quality_gate_is_a_failure_not_a_block(
    production_settings: Settings, production_run: RunContext
):
    composition = read_model(production_run.composition_json, Composition)
    assert composition.output_path is not None
    composition.output_path.write_bytes(composition.output_path.read_bytes() + b"\x00")

    result = release_check(production_settings, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.FAIL
    assert result.state is ReleaseState.DRAFT
    assert not _gates(result)["quality_gates_pass"].passed


def test_required_music_blocks_release_when_it_is_not_approved(
    production_settings: Settings, production_run: RunContext
):
    strict = production_settings.model_copy(update={"require_music": True})

    result = release_check(strict, run_id=production_run.run_id)

    assert result.outcome is ReleaseOutcome.BLOCKED
    assert not _gates(result)["approved_music_is_applied"].passed


def test_the_human_gates_are_reported_without_blocking_candidacy(
    production_settings: Settings, production_run: RunContext
):
    result = release_check(production_settings, run_id=production_run.run_id)

    gates = _gates(result)
    assert not gates["human_review_complete"].passed
    assert not gates["human_approval_recorded"].passed
    assert not gates["human_review_complete"].blocking
    assert result.is_release_candidate, "a candidate is what a human is asked to review"


def test_an_uncomposed_run_cannot_be_checked(compose_settings: Settings, composed_run: RunContext):
    with pytest.raises(StageNotCompletedError, match="compose"):
        release_check(compose_settings, run_id=composed_run.run_id)


def test_the_fingerprint_covers_the_whole_chain(
    production_settings: Settings, production_run: RunContext
):
    first = release_check(production_settings, run_id=production_run.run_id).fingerprint

    voice = read_model(production_run.voice_json, VoiceAsset)
    write_model(production_run.voice_json, voice.model_copy(update={"voice": "cedar"}))
    second = release_check(production_settings, run_id=production_run.run_id).fingerprint

    # voice.json is not part of the fingerprint by itself, but the file it
    # describes is; the identity only moves when the content does.
    assert first.identity == second.identity

    composition = read_model(production_run.composition_json, Composition)
    assert composition.output_path is not None
    composition.output_path.write_bytes(b"different bytes entirely")
    third = release_check(production_settings, run_id=production_run.run_id).fingerprint
    assert third.identity != first.identity
    assert "final_sha256" in first.differences(third)
