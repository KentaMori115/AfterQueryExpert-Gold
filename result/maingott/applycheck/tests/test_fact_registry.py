"""Deterministic fact extraction."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from maingott_reel.models import BlockType, ClaimStatus, FactCategory, SourceBlock, SourceDocument
from maingott_reel.source.docx_reader import read_docx
from maingott_reel.source.fact_registry import (
    MIN_STATEMENT_CHARS,
    classify,
    extract_facts,
    looks_like_target,
)

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO_HASH = "0" * 64


def _document(*blocks: SourceBlock) -> SourceDocument:
    return SourceDocument(
        path=Path("spec.docx"),
        sha256=ZERO_HASH,
        extracted_at=NOW,
        block_count=len(blocks),
        blocks=list(blocks),
    )


def _block(index: int, text: str, **kwargs: object) -> SourceBlock:
    return SourceBlock(index=index, line=index + 1, text=text, **kwargs)  # type: ignore[arg-type]


# --- classification -----------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("AI-контур включает RAG, память и guardrails ассистента.", FactCategory.AI),
        ("Аналитика воронки и KPI по каналам в дашборде.", FactCategory.ANALYTICS),
        ("Интеграция с Bitrix24 через API и вебхуки.", FactCategory.INTEGRATION),
        ("Каналы: Telegram, VK, YouTube, Instagram и FarPost.", FactCategory.CHANNEL),
        ("MainGott — единая цифровая платформа продаж.", FactCategory.POSITIONING),
        ("Погода была прекрасной в тот день.", FactCategory.OTHER),
    ],
)
def test_classify_picks_the_dominant_category(text: str, expected: FactCategory):
    assert classify(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Целевое значение времени первого ответа.",
        "не менее 98% заявок с источником",
        "до 60 сек. для бота",
        "KPI по загрузке команды",
        "ориентир по бюджету проекта",
    ],
)
def test_target_statements_are_detected(text: str):
    assert looks_like_target(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "Bitrix24 является единым источником правды о клиенте и сделке.",
        "Система объединяет сайт, мессенджеры и CRM.",
    ],
)
def test_plain_capabilities_are_not_targets(text: str):
    assert looks_like_target(text) is False


# --- extraction ---------------------------------------------------------


def test_facts_are_verbatim_and_traceable(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    fact = next(f for f in registry.facts if "омниканальную платформу" in f.statement)
    assert fact.statement == fact.source_quote
    assert fact.source_lines == [fact.source_lines[0]]
    assert fact.section == "1. Назначение и бизнес-цели"
    assert fact.id.startswith("F-")


def test_fact_ids_are_sequential_and_unique(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    assert [f.id for f in registry.facts] == [
        f"F-{i:03d}" for i in range(1, len(registry.facts) + 1)
    ]


def test_table_of_contents_and_headings_are_skipped(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    statements = [fact.statement for fact in registry.facts]
    assert "Содержание" not in statements
    assert "1. Назначение и бизнес-цели" not in statements


def test_short_blocks_are_skipped(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    assert all(len(fact.statement) >= MIN_STATEMENT_CHARS for fact in registry.facts)
    assert "Слишком коротко" not in [fact.statement for fact in registry.facts]


def test_duplicate_statements_are_collapsed(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    statements = [fact.statement for fact in registry.facts]
    assert len(statements) == len(set(statements))


def test_target_table_rows_are_marked_as_targets(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    metric = next(f for f in registry.facts if "Время первого ответа" in f.statement)
    assert metric.claim_status is ClaimStatus.TARGET
    assert metric.usable_in_advertising


def test_table_header_rows_are_not_facts(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    assert not any(f.statement.startswith("Показатель") for f in registry.facts)


def test_single_row_callout_tables_are_kept():
    source = _document(
        _block(
            0,
            "ГЛАВНАЯ ЦЕЛЬ — Сократить путь клиента от первого касания до покупки.",
            block_type=BlockType.TABLE_ROW,
            table_index=0,
            row_index=0,
        )
    )
    registry = extract_facts(source, created_at=NOW)
    assert len(registry.facts) == 1


def test_capabilities_stay_supported(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    fact = next(f for f in registry.facts if "Bitrix24" in f.statement)
    assert fact.claim_status is ClaimStatus.SUPPORTED


def test_registry_is_bound_to_the_source_hash(sample_docx: Path):
    source = read_docx(sample_docx)
    registry = extract_facts(source, created_at=NOW)
    assert registry.source_sha256 == source.sha256


def test_extraction_is_deterministic(sample_docx: Path):
    source = read_docx(sample_docx)
    first = extract_facts(source, created_at=NOW)
    second = extract_facts(source, created_at=NOW)
    assert first == second


def test_registry_summaries(sample_docx: Path):
    registry = extract_facts(read_docx(sample_docx), created_at=NOW)
    counts = registry.category_counts()
    assert sum(counts.values()) == len(registry.facts)
    assert registry.by_category(FactCategory.AI)
    assert registry.by_status(ClaimStatus.TARGET)


def test_real_specification_yields_a_usable_registry(real_spec: Path):
    registry = extract_facts(read_docx(real_spec), created_at=NOW)
    assert len(registry.facts) > 150
    assert registry.by_status(ClaimStatus.TARGET)
    assert not registry.by_status(ClaimStatus.UNSUPPORTED)
    text = " ".join(fact.statement for fact in registry.facts)
    for keyword in ("MainGott", "Bitrix24", "Telegram", "AI"):
        assert keyword in text
    assert all(fact.source_lines for fact in registry.facts)
