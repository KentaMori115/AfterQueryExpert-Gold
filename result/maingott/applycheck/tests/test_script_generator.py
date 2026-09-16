"""Converting a model draft into the strict artifacts."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import pytest

from maingott_reel.creative.draft import CreativePlanDraft
from maingott_reel.creative.script_generator import (
    STANDARD_RESTRICTIONS,
    build_beats,
    build_brief,
    build_plan,
)
from maingott_reel.errors import PlanRejectedError
from maingott_reel.models import (
    BeatKind,
    GenerationProvenance,
    Language,
    ValidationCheck,
    ValidationReport,
)

NOW = datetime(2026, 8, 19, tzinfo=UTC)
ZERO_HASH = "0" * 64
DraftFactory = Callable[..., CreativePlanDraft]


def _provenance() -> GenerationProvenance:
    return GenerationProvenance(
        generator_version="1.0",
        prompt_version="1/1",
        system_prompt_sha256=ZERO_HASH,
        user_prompt_sha256=ZERO_HASH,
        provider="fake",
        model="scripted",
        generated_at=NOW,
        source_sha256=ZERO_HASH,
    )


def _report() -> ValidationReport:
    return ValidationReport(
        created_at=NOW, checks=[ValidationCheck(name="facts_exist", passed=True)]
    )


def test_brief_carries_the_standard_restrictions(make_draft: DraftFactory):
    brief = build_brief(
        make_draft(), target_duration_seconds=40, language=Language.RU, aspect_ratio="9:16"
    )
    assert set(STANDARD_RESTRICTIONS) <= set(brief.restrictions)
    assert brief.target_duration_seconds == 40
    assert brief.aspect_ratio == "9:16"
    assert brief.language is Language.RU


def test_brief_keeps_model_restrictions_without_duplicates(make_draft: DraftFactory):
    draft = make_draft(restrictions=["no team members", "no logos of other companies"])
    brief = build_brief(
        draft, target_duration_seconds=40, language=Language.RU, aspect_ratio="9:16"
    )
    assert brief.restrictions.count("no team members") == 1
    assert "no logos of other companies" in brief.restrictions


def test_a_malformed_brief_is_rejected(make_draft: DraftFactory):
    draft = make_draft(core_message="")
    with pytest.raises(PlanRejectedError, match="creative brief is malformed"):
        build_brief(draft, target_duration_seconds=40, language=Language.RU, aspect_ratio="9:16")


def test_beats_get_stable_ids_in_model_order(make_draft: DraftFactory):
    beats = build_beats(make_draft())
    assert [beat.id for beat in beats] == [f"B-{index:02d}" for index in range(1, 9)]
    assert [beat.order for beat in beats] == list(range(1, 9))


def test_beats_are_renumbered_from_the_model_order(
    make_draft: DraftFactory, draft_beats: list[dict[str, object]]
):
    shuffled = [draft_beats[2], draft_beats[0], draft_beats[1], *draft_beats[3:]]
    beats = build_beats(make_draft(shuffled))
    assert beats[0].kind is BeatKind.FRAMING
    assert [beat.order for beat in beats] == list(range(1, 9))


def test_duplicate_fact_ids_inside_a_claim_are_collapsed(
    make_draft: DraftFactory, draft_beats: list[dict[str, object]]
):
    draft_beats[2]["claims"] = [
        {
            "claim": "MainGott объединяет каналы в одну систему.",
            "kind": "factual",
            "source_fact_ids": ["F-001", "F-001"],
        }
    ]
    beats = build_beats(make_draft(draft_beats))
    assert beats[2].claims[0].source_fact_ids == ["F-001"]


def test_a_beat_with_an_unknown_kind_is_rejected(
    make_draft: DraftFactory, draft_beats: list[dict[str, object]]
):
    draft_beats[0]["kind"] = "framing"
    draft = make_draft(draft_beats)
    draft.beats[0].kind = "mystery"  # type: ignore[assignment]
    with pytest.raises(PlanRejectedError, match="malformed"):
        build_beats(draft)


def test_a_draft_without_beats_is_rejected(make_draft: DraftFactory):
    with pytest.raises(PlanRejectedError, match="without beats"):
        build_beats(make_draft([]))


def test_plan_derives_narration_facts_and_totals(make_draft: DraftFactory):
    beats = build_beats(make_draft())
    plan = build_plan(
        beats=beats,
        target_duration_seconds=40,
        language=Language.RU,
        validation=_report(),
        provenance=_provenance(),
        created_at=NOW,
    )
    assert plan.total_estimated_seconds == round(sum(beat.estimated_seconds for beat in beats), 2)
    assert plan.narration == "\n".join(beat.narration for beat in beats)
    assert plan.source_fact_ids == ["F-001", "F-002", "F-004", "F-005", "F-003", "F-006"]
    assert len(plan.claims) == sum(len(beat.claims) for beat in beats)
    assert plan.created_at == NOW


def test_a_plan_that_breaks_the_schema_is_rejected(make_draft: DraftFactory):
    beats = build_beats(make_draft())
    for beat in beats:
        beat.estimated_seconds = 19.0
    with pytest.raises(PlanRejectedError, match="invalid"):
        build_plan(
            beats=beats,
            target_duration_seconds=40,
            language=Language.RU,
            validation=_report(),
            provenance=_provenance(),
        )
