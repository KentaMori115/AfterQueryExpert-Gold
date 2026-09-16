"""Choosing the facts the planner may cite."""

from __future__ import annotations

from datetime import UTC, datetime

from maingott_reel.creative.fact_selection import (
    MAX_STATEMENT_CHARS,
    MIN_STATEMENT_CHARS,
    select_facts,
)
from maingott_reel.models import ClaimStatus, Fact, FactCategory, FactRegistry

NOW = datetime(2026, 8, 19, tzinfo=UTC)


def _registry(facts: list[Fact]) -> FactRegistry:
    return FactRegistry(source_sha256="b" * 64, created_at=NOW, facts=facts)


def _fact(index: int, category: FactCategory, status: ClaimStatus = ClaimStatus.SUPPORTED) -> Fact:
    return Fact(
        id=f"F-{index:03d}",
        statement=f"Факт номер {index} о платформе MainGott и её рабочих контурах.",
        category=category,
        claim_status=status,
    )


def test_supported_facts_are_offered(registry: FactRegistry):
    selection = select_facts(registry)
    assert "F-001" in selection.fact_ids
    assert len(selection.facts) == 6


def test_unsupported_facts_are_never_offered(registry: FactRegistry):
    assert "F-901" not in select_facts(registry).fact_ids
    assert "F-901" not in select_facts(registry, allow_targets=True).fact_ids


def test_target_facts_are_excluded_by_default(registry: FactRegistry):
    assert "F-900" not in select_facts(registry).fact_ids
    assert select_facts(registry).target_fact_ids == []


def test_target_facts_can_be_offered_explicitly(registry: FactRegistry):
    selection = select_facts(registry, allow_targets=True)
    assert "F-900" in selection.fact_ids
    assert selection.target_fact_ids == ["F-900"]


def test_selection_keeps_document_order(registry: FactRegistry):
    ids = select_facts(registry).fact_ids
    assert ids == sorted(ids)


def test_selection_is_deterministic(registry: FactRegistry):
    assert select_facts(registry).fact_ids == select_facts(registry).fact_ids


def test_overall_budget_is_enforced():
    facts = [_fact(index, FactCategory.CHANNEL) for index in range(1, 40)]
    selection = select_facts(_registry(facts), max_facts=10, max_per_category=30)
    assert len(selection.facts) == 10


def test_per_category_budget_is_enforced():
    facts = [_fact(index, FactCategory.AI) for index in range(1, 30)]
    facts += [_fact(index, FactCategory.CHANNEL) for index in range(30, 60)]
    selection = select_facts(_registry(facts), max_per_category=3)
    categories = [fact.category for fact in selection.facts]
    assert categories.count(FactCategory.AI) == 3
    assert categories.count(FactCategory.CHANNEL) == 3


def test_fragments_and_walls_of_text_are_skipped():
    short = Fact(id="F-001", statement="Слишком коротко тут", category=FactCategory.OTHER)
    wall = Fact(id="F-002", statement="д" * (MAX_STATEMENT_CHARS + 1), category=FactCategory.OTHER)
    keep = _fact(3, FactCategory.OTHER)
    assert len(short.statement) < MIN_STATEMENT_CHARS
    selection = select_facts(_registry([short, wall, keep]))
    assert selection.fact_ids == ["F-003"]


def test_render_marks_targets_and_keeps_ids(registry: FactRegistry):
    rendered = select_facts(registry, allow_targets=True).render()
    assert "F-001 [positioning]" in rendered
    assert "[TARGET" in rendered
    target_line = next(line for line in rendered.splitlines() if line.startswith("F-900"))
    assert "TARGET" in target_line
    assert "F-901" not in rendered
