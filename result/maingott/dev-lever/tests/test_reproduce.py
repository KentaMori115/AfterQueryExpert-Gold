"""The reproducibility check."""

from __future__ import annotations

from maingott_reel.config import Settings
from maingott_reel.release import approval as approval_store
from maingott_reel.release import package as release_package
from maingott_reel.release.inputs import fingerprint, load_inputs
from maingott_reel.release.reproduce import check_package, check_run
from maingott_reel.utils.run_context import RunContext


def _names(report) -> dict[str, bool]:
    return {item.name: item.available for item in report.items}


def test_a_complete_run_is_reproducible(production_settings: Settings, production_run: RunContext):
    from maingott_reel.release.checker import release_check

    release_check(production_settings, run_id=production_run.run_id)
    report = check_run(production_settings, load_inputs(production_run))

    # The fixture builds its run without ever writing the DOCX, so the source
    # document is the one input that is genuinely not recoverable here.
    assert [item.name for item in report.missing] == ["source specification"]
    available = _names(report)
    for expected in (
        "facts",
        "plan",
        "storyboard",
        "shot prompts",
        "prompt versions",
        "assets record",
        "asset files",
        "voice record",
        "voice audio",
        "composition",
        "manifest",
        "finished Reel",
    ):
        assert available[expected], expected


def test_a_missing_source_document_is_reported(
    production_settings: Settings, production_run: RunContext
):
    report = check_run(production_settings, load_inputs(production_run))

    # The fixture never writes the DOCX, so this is genuinely unavailable.
    assert not _names(report)["source specification"]
    assert not report.reproducible
    assert "source specification" in [item.name for item in report.missing]


def test_a_missing_asset_file_is_reported(
    production_settings: Settings, production_run: RunContext
):
    inputs = load_inputs(production_run)
    asset = inputs.assets.assets[0]
    assert asset.path is not None
    asset.path.unlink()

    report = check_run(production_settings, load_inputs(production_run))

    assert not _names(report)["asset files"]
    assert not report.reproducible


def test_a_missing_voice_record_is_reported(
    production_settings: Settings, production_run: RunContext
):
    production_run.voice_json.unlink()

    report = check_run(production_settings, load_inputs(production_run))

    assert not _names(report)["voice record"]


def test_a_missing_configuration_snapshot_is_reported(
    production_settings: Settings, production_run: RunContext
):
    from maingott_reel.release.checker import release_check

    release_check(production_settings, run_id=production_run.run_id)
    assert _names(check_run(production_settings, load_inputs(production_run)))[
        "configuration snapshot"
    ]

    production_run.configuration_json.unlink()
    assert not _names(check_run(production_settings, load_inputs(production_run)))[
        "configuration snapshot"
    ]


def test_the_provider_log_is_recorded_but_not_required(
    production_settings: Settings, production_run: RunContext
):
    report = check_run(production_settings, load_inputs(production_run))
    item = next(item for item in report.items if item.name == "provider request log")
    assert not item.required


def test_a_release_package_is_auditable_on_its_own(
    production_settings: Settings, approved_run: RunContext
):
    inputs = load_inputs(approved_run)
    identity = fingerprint(production_settings, inputs)
    approval = approval_store.load_approval(approved_run)
    assert approval is not None
    package = release_package.build(production_settings, inputs, identity, approval)

    report = check_package(package.root, package.manifest)

    assert report.reproducible, [item.name for item in report.missing]
    assert _names(report)["configuration snapshot"]
    assert _names(report)["provider metadata"]


def test_a_tampered_release_is_not_reproducible(
    production_settings: Settings, approved_run: RunContext
):
    inputs = load_inputs(approved_run)
    identity = fingerprint(production_settings, inputs)
    approval = approval_store.load_approval(approved_run)
    assert approval is not None
    package = release_package.build(production_settings, inputs, identity, approval)
    (package.root / "metadata" / "script.json").write_text("{}", encoding="utf-8")

    report = check_package(package.root, package.manifest)

    assert not report.reproducible
    assert "plan" in [item.name for item in report.missing]
