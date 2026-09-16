"""Comparing two runs."""

from __future__ import annotations

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import RunNotFoundError
from maingott_reel.models import (
    Composition,
    SceneTransition,
    ScriptPlan,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.release.compare import compare_runs
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext, create_run


def _clone(settings: Settings, run: RunContext, run_id: str) -> RunContext:
    """Copy a finished run into a second run directory."""
    import shutil

    clone = create_run(settings, run_id=run_id)
    for item in run.root.iterdir():
        target = clone.root / item.name
        if item.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    return clone


def _changed(report) -> set[str]:
    return {item.aspect for item in report.changed}


def test_a_run_compared_with_its_copy_is_identical(
    compose_settings: Settings, production_run: RunContext
):
    clone = _clone(compose_settings, production_run, "clone")

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert report.identical, [item.aspect for item in report.changed]
    assert "identical" in report.summary()


def test_a_changed_narration_is_reported(compose_settings: Settings, production_run: RunContext):
    clone = _clone(compose_settings, production_run, "clone")
    plan = read_model(clone.script_json, ScriptPlan)
    beats = [
        beat.model_copy(update={"narration": beat.narration.replace("соединяет", "связывает")})
        for beat in plan.beats
    ]
    narration = "\n".join(beat.narration for beat in beats)
    write_model(clone.script_json, plan.model_copy(update={"beats": beats, "narration": narration}))

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert "narration" in _changed(report)
    assert not report.identical


def test_a_changed_storyboard_is_reported(compose_settings: Settings, production_run: RunContext):
    clone = _clone(compose_settings, production_run, "clone")
    board = read_model(clone.storyboard_json, Storyboard)
    scenes = list(board.scenes)
    scenes[-1] = scenes[-1].model_copy(update={"transition": SceneTransition.FADE})
    write_model(clone.storyboard_json, board.model_copy(update={"scenes": scenes}))

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert "transitions" in _changed(report)


def test_a_changed_asset_is_reported(compose_settings: Settings, production_run: RunContext):
    from maingott_reel.models import AssetCollection

    clone = _clone(compose_settings, production_run, "clone")
    collection = read_model(clone.assets_json, AssetCollection)
    assets = list(collection.assets)
    assets[0] = assets[0].model_copy(update={"sha256": "c" * 64})
    write_model(clone.assets_json, collection.model_copy(update={"assets": assets}))

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert "assets" in _changed(report)


def test_a_changed_voice_is_reported(compose_settings: Settings, production_run: RunContext):
    clone = _clone(compose_settings, production_run, "clone")
    voice = read_model(clone.voice_json, VoiceAsset)
    write_model(clone.voice_json, voice.model_copy(update={"voice": "cedar"}))

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert "voice" in _changed(report)


def test_a_changed_final_file_is_reported(compose_settings: Settings, production_run: RunContext):
    clone = _clone(compose_settings, production_run, "clone")
    composition = read_model(clone.composition_json, Composition)
    assert composition.output_path is not None
    final = clone.final_video
    final.write_bytes(final.read_bytes() + b"\x00" * 32)
    write_model(clone.composition_json, composition.model_copy(update={"output_path": final}))

    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    assert "final file" in _changed(report)
    assert "final size" in _changed(report)


def test_comparing_covers_the_whole_pipeline(
    compose_settings: Settings, production_run: RunContext
):
    clone = _clone(compose_settings, production_run, "clone")
    report = compare_runs(compose_settings, production_run.run_id, clone.run_id)

    aspects = {item.aspect for item in report.differences}
    for expected in (
        "source specification",
        "narration",
        "scenes",
        "assets",
        "voice",
        "composition",
        "final duration",
        "resolution",
        "final file",
    ):
        assert expected in aspects


def test_comparing_an_unknown_run_fails(compose_settings: Settings, production_run: RunContext):
    with pytest.raises(RunNotFoundError):
        compare_runs(compose_settings, production_run.run_id, "does-not-exist")
