"""Hashing, JSON persistence and run directories."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import RunNotFoundError, StageNotCompletedError
from maingott_reel.models import Fact, FactRegistry
from maingott_reel.utils.hashing import prompt_hash, sha256_file, sha256_text
from maingott_reel.utils.jsonio import read_json, read_model, write_json, write_model
from maingott_reel.utils.run_context import (
    LATEST_POINTER,
    create_run,
    new_run_id,
    read_latest,
    resolve_run,
)

ZERO_HASH = "0" * 64


def test_sha256_text_is_stable():
    assert sha256_text("maingott") == sha256_text("maingott")
    assert sha256_text("a") != sha256_text("b")


def test_sha256_file_matches_text_hash(tmp_path: Path):
    path = tmp_path / "sample.txt"
    path.write_text("maingott", encoding="utf-8")
    assert sha256_file(path) == sha256_text("maingott")


def test_prompt_hash_depends_on_parameters():
    base = prompt_hash("a scene", model="sora-2", seconds=5)
    assert base == prompt_hash("a scene", seconds=5, model="sora-2")
    assert base != prompt_hash("a scene", model="sora-2", seconds=6)


def test_write_and_read_json_roundtrip(tmp_path: Path):
    path = write_json(tmp_path / "nested" / "data.json", {"b": 1, "a": 2})
    assert read_json(path) == {"a": 2, "b": 1}


def test_json_output_is_sorted_and_indented(tmp_path: Path):
    path = write_json(tmp_path / "data.json", {"b": 1, "a": 2})
    text = path.read_text(encoding="utf-8")
    assert text.index('"a"') < text.index('"b"')
    assert text.endswith("\n")


def test_model_roundtrip(tmp_path: Path):
    registry = FactRegistry(
        source_sha256=ZERO_HASH,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        facts=[Fact(id="F-001", statement="MainGott is a Sales & Operations OS.")],
    )
    path = write_model(tmp_path / "facts.json", registry)
    assert read_model(path, FactRegistry) == registry


def test_new_run_id_is_sortable():
    run_id = new_run_id(datetime(2026, 8, 19, 21, 30, 15, tzinfo=UTC))
    assert run_id == "20260819-213015"


def test_create_run_builds_the_documented_layout(settings: Settings):
    run = create_run(settings, run_id="test-run")
    assert run.root == settings.runs_root / "test-run"
    for directory in (run.root, run.assets_dir, run.final_dir, run.logs_dir):
        assert directory.is_dir()
    assert run.facts_json.name == "facts.json"
    assert run.final_video == run.root / "final" / "maingott_reel.mp4"
    assert run.log_file == run.root / "logs" / "run.jsonl"


def test_create_run_is_idempotent(settings: Settings):
    first = create_run(settings, run_id="test-run")
    second = create_run(settings, run_id="test-run")
    assert first == second


def test_latest_pointer_tracks_the_newest_run(settings: Settings):
    create_run(settings, run_id="run-a")
    create_run(settings, run_id="run-b")
    assert read_latest(settings) == "run-b"
    assert (settings.runs_root / LATEST_POINTER).is_file()
    assert resolve_run(settings).run_id == "run-b"


def test_resolve_run_without_any_run_fails(settings: Settings):
    with pytest.raises(RunNotFoundError):
        resolve_run(settings)


def test_resolve_run_with_unknown_id_fails(settings: Settings):
    create_run(settings, run_id="run-a")
    with pytest.raises(RunNotFoundError):
        resolve_run(settings, run_id="missing")


def test_require_names_the_stage_that_must_run_first(settings: Settings):
    run = create_run(settings, run_id="run-a")
    with pytest.raises(StageNotCompletedError, match="analyze"):
        run.require(run.facts_json, "analyze")
    write_json(run.facts_json, {})
    assert run.require(run.facts_json, "analyze") == run.facts_json


def test_run_layout_covers_every_documented_artifact(settings: Settings):
    run = create_run(settings, run_id="run-a")
    artifacts = {
        run.source_json,
        run.facts_json,
        run.creative_brief_json,
        run.script_json,
        run.storyboard_json,
        run.assets_json,
        run.composition_json,
        run.validation_json,
        run.manifest_json,
    }
    assert {path.name for path in artifacts} == {
        "source.json",
        "facts.json",
        "creative_brief.json",
        "script.json",
        "storyboard.json",
        "assets.json",
        "composition.json",
        "validation.json",
        "manifest.json",
    }
    assert all(path.parent == run.root for path in artifacts)


def test_read_latest_ignores_an_empty_pointer(settings: Settings):
    create_run(settings, run_id="run-a")
    (settings.runs_root / LATEST_POINTER).write_text("\n", encoding="utf-8")
    assert read_latest(settings) is None
