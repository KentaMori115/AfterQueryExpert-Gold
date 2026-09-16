"""Fact registry.

Turns the parsed specification into a registry of verbatim, traceable
statements. Extraction is fully deterministic and never calls a model: the
registry is the evidence base that later stages must cite, so it may not
contain anything the specification does not literally say.

Two derived attributes are heuristic and meant as planning hints:

``category``
    keyword scoring, used to group facts for the creative planner;
``claim_status``
    conservative target detection. Anything that looks like a target value,
    KPI or acceptance threshold is marked :attr:`ClaimStatus.TARGET`, because
    presenting a design target as an achieved result is forbidden by
    ``docs/creative/CLAIMS_POLICY.md``.

Statements themselves are copied verbatim and keep a pointer back to the
source block, so a human can always verify them.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime

from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    BlockType,
    ClaimStatus,
    Fact,
    FactCategory,
    FactRegistry,
    SourceBlock,
    SourceDocument,
)

logger = get_logger("source.facts")

#: Statements shorter than this carry no usable business meaning.
MIN_STATEMENT_CHARS = 25

#: Sections that hold navigation rather than content.
SKIPPED_SECTIONS = ("содержание", "оглавление", "приложения", "contents")

#: Text that marks a design target, a KPI or an acceptance threshold.
_TARGET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bцел[ьиеяю]|\bцелев", re.IGNORECASE),
    re.compile(r"\bkpi\b|\bsla\b", re.IGNORECASE),
    re.compile(r"не\s+менее|не\s+более|не\s+должн", re.IGNORECASE),
    re.compile(r"\bдо\s+\d+\s*(сек|мин|час|дн|%)", re.IGNORECASE),
    re.compile(r"\d+\s*%"),
    re.compile(r"ориентир|норматив|критери[йи]\s+при[её]мк", re.IGNORECASE),
    re.compile(r"\bплановы|\bпланируем", re.IGNORECASE),
)

#: Table header cells that identify a table of target values.
_TARGET_TABLE_HEADERS = ("целевое значение", "критерий", "kpi", "ожидаемый результат")

#: Keyword hints per category. Matching is case-insensitive substring scoring.
_CATEGORY_KEYWORDS: dict[FactCategory, tuple[str, ...]] = {
    FactCategory.AI: (
        "ai",
        "искусственн",
        "нейросет",
        "llm",
        "rag",
        "промпт",
        "guardrail",
        "база знаний",
        "ассистент",
        "бот",
        "генерац",
    ),
    FactCategory.ANALYTICS: (
        "аналитик",
        "kpi",
        "отчёт",
        "отчет",
        "дашборд",
        "метрик",
        "воронк",
        "utm",
        "показател",
        "измерен",
    ),
    FactCategory.INTEGRATION: (
        "bitrix",
        "битрикс",
        "интеграц",
        "api",
        "вебхук",
        "webhook",
        "1с",
        "синхрониз",
        "обмен данными",
    ),
    FactCategory.CHANNEL: (
        "telegram",
        "vk",
        "youtube",
        "instagram",
        "farpost",
        "max",
        "сайт",
        "канал",
        "омниканал",
        "мессенджер",
        "контент",
    ),
    FactCategory.CUSTOMER_JOURNEY: (
        "путь клиент",
        "квалификац",
        "лид",
        "сделк",
        "встреч",
        "оплат",
        "заявк",
        "follow-up",
        "обращени",
        "клиент",
        "покуп",
    ),
    FactCategory.ARCHITECTURE: (
        "архитектур",
        "модул",
        "компонент",
        "инфраструктур",
        "сервис",
        "хранилищ",
        "контур",
        "платформ",
        "систем",
    ),
    FactCategory.OPERATIONS: (
        "процесс",
        "регламент",
        "роль",
        "доступ",
        "безопасн",
        "бухгалтер",
        "касс",
        "документооборот",
        "управленческ",
        "ответственн",
    ),
    FactCategory.POSITIONING: (
        "maingott",
        "майнготт",
        "operations os",
        "единая цифровая",
        "назначение",
        "продукт",
    ),
    FactCategory.CAPABILITY: (
        "автоматизир",
        "позволяет",
        "обеспечива",
        "должен",
        "должна",
        "поддержива",
        "формирует",
        "создаёт",
        "создает",
    ),
}

#: Tie-break order when several categories score equally.
_CATEGORY_PRIORITY: tuple[FactCategory, ...] = (
    FactCategory.POSITIONING,
    FactCategory.AI,
    FactCategory.ANALYTICS,
    FactCategory.INTEGRATION,
    FactCategory.CHANNEL,
    FactCategory.CUSTOMER_JOURNEY,
    FactCategory.ARCHITECTURE,
    FactCategory.OPERATIONS,
    FactCategory.CAPABILITY,
)


def classify(text: str) -> FactCategory:
    """Return the best-scoring category for ``text``."""
    lowered = text.lower()
    scores = {
        category: sum(1 for keyword in keywords if keyword in lowered)
        for category, keywords in _CATEGORY_KEYWORDS.items()
    }
    best = max(scores.values(), default=0)
    if best == 0:
        return FactCategory.OTHER
    return next(category for category in _CATEGORY_PRIORITY if scores.get(category, 0) == best)


def looks_like_target(text: str) -> bool:
    """Whether ``text`` states a design target rather than a plain capability."""
    return any(pattern.search(text) for pattern in _TARGET_PATTERNS)


def _target_table_indexes(source: SourceDocument) -> set[int]:
    """Return the indexes of tables whose header announces target values."""
    indexes: set[int] = set()
    for block in source.blocks:
        if block.block_type is not BlockType.TABLE_ROW or block.row_index != 0:
            continue
        header = block.text.lower()
        if block.table_index is not None and any(m in header for m in _TARGET_TABLE_HEADERS):
            indexes.add(block.table_index)
    return indexes


def _table_row_counts(source: SourceDocument) -> Counter[int]:
    """Count the emitted rows per table."""
    return Counter(
        block.table_index
        for block in source.blocks
        if block.block_type is BlockType.TABLE_ROW and block.table_index is not None
    )


def _is_candidate(block: SourceBlock, row_counts: Counter[int]) -> bool:
    """Whether a block can carry a business statement."""
    if block.block_type is BlockType.HEADING:
        return False
    section = (block.section or "").lower()
    if any(section.startswith(skipped) for skipped in SKIPPED_SECTIONS):
        return False
    if len(block.text) < MIN_STATEMENT_CHARS:
        return False
    if block.block_type is BlockType.TABLE_ROW:
        # The first row of a multi-row table is a header, not a statement.
        rows = row_counts.get(block.table_index or 0, 0)
        if block.row_index == 0 and rows > 1:
            return False
    return True


def _claim_status(block: SourceBlock, target_tables: set[int]) -> ClaimStatus:
    """Classify how a block's statement may be used in advertising."""
    if block.table_index is not None and block.table_index in target_tables:
        return ClaimStatus.TARGET
    return ClaimStatus.TARGET if looks_like_target(block.text) else ClaimStatus.SUPPORTED


def extract_facts(source: SourceDocument, created_at: datetime | None = None) -> FactRegistry:
    """Build the fact registry for a parsed specification.

    The same document always produces the same facts and the same ids.
    """
    target_tables = _target_table_indexes(source)
    row_counts = _table_row_counts(source)

    facts: list[Fact] = []
    seen: set[str] = set()
    for block in source.blocks:
        if not _is_candidate(block, row_counts):
            continue
        key = block.text.casefold()
        if key in seen:
            continue
        seen.add(key)
        facts.append(
            Fact(
                id=f"F-{len(facts) + 1:03d}",
                statement=block.text,
                category=classify(block.text),
                claim_status=_claim_status(block, target_tables),
                source_page=block.page,
                source_lines=[block.line],
                source_quote=block.text,
                section=block.subsection or block.section,
            )
        )

    registry = FactRegistry(
        source_sha256=source.sha256,
        created_at=created_at or datetime.now(tz=UTC),
        facts=facts,
    )
    logger.info(
        "fact registry built",
        extra={
            "facts": len(facts),
            "targets": len(registry.by_status(ClaimStatus.TARGET)),
            "categories": registry.category_counts(),
        },
    )
    return registry
