"""The immutable release package."""

from __future__ import annotations

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import ReleaseError
from maingott_reel.models import ApprovalStatus, ReleaseManifest
from maingott_reel.release import approval as approval_store
from maingott_reel.release import package as release_package
from maingott_reel.release.inputs import fingerprint, load_inputs
from maingott_reel.utils.jsonio import read_model
from maingott_reel.utils.run_context import RunContext


def _build(settings: Settings, run: RunContext) -> release_package.ReleasePackage:
    inputs = load_inputs(run)
    identity = fingerprint(settings, inputs)
    approval = approval_store.load_approval(run)
    assert approval is not None
    return release_package.build(settings, inputs, identity, approval)


# --- building -------------------------------------------------------------------


def test_a_release_package_is_written(production_settings: Settings, approved_run: RunContext):
    package = _build(production_settings, approved_run)

    assert package.root.is_dir()
    assert package.final_video.is_file()
    assert package.release_json.is_file()
    assert package.release_id.startswith("rel-")
    assert (package.root / "metadata" / "approval.json").is_file()
    assert (package.root / "metadata" / "composition.json").is_file()
    assert (package.root / "metadata" / "voice.json").is_file()


def test_the_release_id_is_content_not_a_timestamp(
    production_settings: Settings, approved_run: RunContext
):
    first = _build(production_settings, approved_run)
    identity = fingerprint(production_settings, load_inputs(approved_run))

    assert first.release_id == identity.release_id
    assert first.manifest.release_id == first.manifest.fingerprint.release_id


def test_building_twice_returns_the_same_package(
    production_settings: Settings, approved_run: RunContext
):
    first = _build(production_settings, approved_run)
    written = first.final_video.stat().st_mtime

    second = _build(production_settings, approved_run)

    assert second.release_id == first.release_id
    assert second.final_video.stat().st_mtime == written


def test_the_package_records_every_file_with_its_hash(
    production_settings: Settings, approved_run: RunContext
):
    package = _build(production_settings, approved_run)

    manifest = read_model(package.release_json, ReleaseManifest)
    names = {entry.name for entry in manifest.files}
    assert {"final", *release_package.REQUIRED_METADATA} <= names
    for entry in manifest.files:
        assert (package.root / entry.path).is_file()
    assert manifest.approved_by == "Release Manager"
    assert manifest.release_version == "v1.0.0"
    assert not manifest.development


def test_the_original_run_is_never_modified(
    production_settings: Settings, approved_run: RunContext
):
    before = {
        path: path.read_bytes()
        for path in (
            approved_run.composition_json,
            approved_run.storyboard_json,
            approved_run.approval_json,
        )
    }
    inputs = load_inputs(approved_run)
    final_before = inputs.final_path.read_bytes()

    _build(production_settings, approved_run)

    for path, content in before.items():
        assert path.read_bytes() == content
    assert inputs.final_path.read_bytes() == final_before


def test_a_development_reel_is_never_packaged(compose_settings: Settings, composed_run: RunContext):
    from maingott_reel.audit.auditor import audit
    from maingott_reel.video.composition import compose

    compose(compose_settings, run_id=composed_run.run_id, silent_voice=True, no_logo=True)
    audit(compose_settings, run_id=composed_run.run_id)
    inputs = load_inputs(composed_run)
    identity = fingerprint(compose_settings, inputs)
    approval = approval_store.create(
        run=composed_run,
        fingerprint=identity,
        approved_by="Someone",
        release_version="v1.0.0",
        status=ApprovalStatus.REJECTED,
    )
    approved = approval.model_copy(update={"status": ApprovalStatus.APPROVED})

    with pytest.raises(ReleaseError, match="development Reel"):
        release_package.build(compose_settings, inputs, identity, approved)


def test_an_approval_for_other_content_cannot_be_packaged(
    production_settings: Settings, approved_run: RunContext
):
    inputs = load_inputs(approved_run)
    identity = fingerprint(production_settings, inputs)
    approval = approval_store.load_approval(approved_run)
    assert approval is not None
    stale = approval.model_copy(
        update={"fingerprint": identity.model_copy(update={"final_sha256": "c" * 64})}
    )

    with pytest.raises(ReleaseError, match="does not describe this Reel"):
        release_package.build(production_settings, inputs, identity, stale)


def test_a_missing_required_artifact_stops_the_release(
    production_settings: Settings, approved_run: RunContext
):
    approved_run.validation_json.unlink()
    inputs = load_inputs(approved_run)
    identity = fingerprint(production_settings, inputs)
    approval = approval_store.load_approval(approved_run)
    assert approval is not None

    with pytest.raises(ReleaseError, match="missing validation"):
        release_package.build(production_settings, inputs, identity, approval)


# --- validating -------------------------------------------------------------------


def test_a_fresh_package_validates(production_settings: Settings, approved_run: RunContext):
    package = _build(production_settings, approved_run)

    result = release_package.validate(package)

    assert result.passed, result.failures
    assert "package checks passed" in result.summary()


def test_a_tampered_reel_fails_validation(production_settings: Settings, approved_run: RunContext):
    package = _build(production_settings, approved_run)
    package.final_video.write_bytes(package.final_video.read_bytes() + b"\x00")

    result = release_package.validate(package)

    assert not result.passed
    names = {name for name, _, _ in result.failures}
    assert "file_unchanged::final" in names
    assert "final_matches_the_fingerprint" in names


def test_tampered_metadata_fails_validation(
    production_settings: Settings, approved_run: RunContext
):
    package = _build(production_settings, approved_run)
    (package.root / "metadata" / "composition.json").write_text("{}", encoding="utf-8")

    result = release_package.validate(package)

    assert not result.passed
    assert "file_unchanged::composition" in {name for name, _, _ in result.failures}


def test_a_missing_packaged_file_fails_validation(
    production_settings: Settings, approved_run: RunContext
):
    package = _build(production_settings, approved_run)
    (package.root / "metadata" / "storyboard.json").unlink()

    result = release_package.validate(package)

    assert not result.passed
    assert "file_present::storyboard" in {name for name, _, _ in result.failures}


def test_a_swapped_approval_fails_validation(
    production_settings: Settings, approved_run: RunContext
):
    package = _build(production_settings, approved_run)
    from maingott_reel.models import ApprovalRecord
    from maingott_reel.utils.jsonio import write_model

    path = package.root / "metadata" / "approval.json"
    record = read_model(path, ApprovalRecord)
    write_model(path, record.model_copy(update={"approved_by": "Somebody Else"}))

    result = release_package.validate(package)

    assert not result.passed
    names = {name for name, _, _ in result.failures}
    assert "file_unchanged::approval" in names
    assert "approval_matches_the_release" in names


def test_a_release_can_be_loaded_by_id(production_settings: Settings, approved_run: RunContext):
    built = _build(production_settings, approved_run)

    loaded = release_package.load(production_settings, built.release_id)
    assert loaded.manifest.release_id == built.release_id
    assert release_package.latest(production_settings) == built.release_id


def test_loading_an_unknown_release_fails(production_settings: Settings):
    with pytest.raises(ReleaseError, match="no release package"):
        release_package.load(production_settings, "rel-0000000000000000")
    assert release_package.latest(production_settings) is None


def test_an_unreadable_release_manifest_is_reported(
    production_settings: Settings, approved_run: RunContext
):
    package = _build(production_settings, approved_run)
    package.release_json.write_text("{not json", encoding="utf-8")

    with pytest.raises(ReleaseError, match="unreadable"):
        release_package.load(production_settings, package.release_id)
