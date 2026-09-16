"""The analyze stage: persistence, idempotency and manifest bookkeeping."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.config import Settings
from maingott_reel.errors import SourceError
from maingott_reel.models import FactRegistry, RunManifest, SourceDocument, StageName
from maingott_reel.source.analyzer import analyze
from maingott_reel.utils.jsonio import read_model, write_json
from maingott_reel.utils.manifest_store import load_manifest, load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import create_run, read_latest


def test_analyze_writes_source_and_facts(settings: Settings, sample_docx: Path):
    result = analyze(settings, source_path=sample_docx)

    assert result.reused is False
    assert result.run.source_json.is_file()
    assert result.run.facts_json.is_file()
    assert read_model(result.run.source_json, SourceDocument).sha256 == result.source.sha256
    assert read_model(result.run.facts_json, FactRegistry).facts == result.registry.facts
    assert result.fact_count == len(result.registry.facts) > 0


def test_analyze_records_the_stage_in_the_manifest(settings: Settings, sample_docx: Path):
    result = analyze(settings, source_path=sample_docx)
    manifest = read_model(result.run.manifest_json, RunManifest)

    assert manifest.run_id == result.run.run_id
    assert manifest.source_sha256 == result.source.sha256
    assert manifest.source_path == sample_docx
    assert manifest.stage_completed(StageName.ANALYZE)
    assert set(manifest.files) == {"source", "facts"}


def test_analyze_marks_the_run_as_latest(settings: Settings, sample_docx: Path):
    result = analyze(settings, source_path=sample_docx)
    assert read_latest(settings) == result.run.run_id


def test_missing_source_is_reported(settings: Settings, tmp_path: Path):
    with pytest.raises(SourceError, match="not found"):
        analyze(settings, source_path=tmp_path / "absent.docx")


def test_rerun_on_the_same_document_is_reused(settings: Settings, sample_docx: Path):
    first = analyze(settings, source_path=sample_docx)
    before = first.run.facts_json.read_bytes()

    second = analyze(settings, run_id=first.run.run_id, source_path=sample_docx)

    assert second.reused is True
    assert second.run.run_id == first.run.run_id
    assert second.run.facts_json.read_bytes() == before


def test_force_re_extracts_the_same_facts(settings: Settings, sample_docx: Path):
    first = analyze(settings, source_path=sample_docx)
    second = analyze(settings, run_id=first.run.run_id, source_path=sample_docx, force=True)

    assert second.reused is False
    assert [f.model_dump() for f in second.registry.facts] == [
        f.model_dump() for f in first.registry.facts
    ]


def test_a_changed_document_is_re_analysed(settings: Settings, sample_docx: Path, tmp_path: Path):
    from docx import Document

    first = analyze(settings, source_path=sample_docx)

    document = Document(str(sample_docx))
    document.add_paragraph("Дополнительное требование к контент-машине MainGott и каналам.")
    changed = tmp_path / "spec_v2.docx"
    document.save(changed)

    second = analyze(settings, run_id=first.run.run_id, source_path=changed)

    assert second.reused is False
    assert second.source.sha256 != first.source.sha256
    assert len(second.registry.facts) == len(first.registry.facts) + 1


def test_unreadable_artifacts_are_regenerated(settings: Settings, sample_docx: Path):
    first = analyze(settings, source_path=sample_docx)
    first.run.facts_json.write_text("{ this is not json", encoding="utf-8")

    second = analyze(settings, run_id=first.run.run_id, source_path=sample_docx)

    assert second.reused is False
    assert read_model(second.run.facts_json, FactRegistry).facts == second.registry.facts


def test_artifacts_from_another_source_are_ignored(settings: Settings, sample_docx: Path):
    first = analyze(settings, source_path=sample_docx)
    stale = read_model(first.run.source_json, SourceDocument).model_dump(mode="json")
    stale["sha256"] = "f" * 64
    write_json(first.run.source_json, stale)

    second = analyze(settings, run_id=first.run.run_id, source_path=sample_docx)

    assert second.reused is False


def test_on_run_created_fires_before_extraction(settings: Settings, sample_docx: Path):
    seen: list[str] = []
    result = analyze(
        settings, source_path=sample_docx, on_run_created=lambda run: seen.append(run.run_id)
    )
    assert seen == [result.run.run_id]


def test_manifest_store_roundtrip(settings: Settings):
    run = create_run(settings, run_id="run-a")
    assert load_manifest(run) is None

    manifest = load_or_create_manifest(run)
    assert manifest.run_id == "run-a"
    save_manifest(run, manifest)

    reloaded = load_manifest(run)
    assert reloaded is not None
    assert reloaded.run_id == "run-a"
    assert load_or_create_manifest(run).created_at == manifest.created_at
