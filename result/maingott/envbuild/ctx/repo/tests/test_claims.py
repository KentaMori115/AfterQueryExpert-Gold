"""Deterministic claim validation.

These tests are the safety net for the claims policy: they must fail loudly if
anyone weakens the rules that keep unsupported or target claims out of a Reel.
"""

from __future__ import annotations

import pytest

from maingott_reel.creative.claims import ClaimPolicy, failure_feedback, validate_plan
from maingott_reel.models import (
    BeatKind,
    ClaimKind,
    ClaimReference,
    CreativeBrief,
    FactRegistry,
    Language,
    ScriptBeat,
)

ALL_OFFERED = frozenset({"F-001", "F-002", "F-003", "F-004", "F-005", "F-006"})


def _brief(**overrides: object) -> CreativeBrief:
    fields: dict[str, object] = {
        "objective": "Представить MainGott как единую систему продаж и операций.",
        "audience": "Руководители бизнеса",
        "target_duration_seconds": 40,
        "tone": "спокойный и уверенный",
        "visual_direction": "тёмная премиальная среда",
        "core_message": "MainGott — Sales & Operations OS.",
        "cta": "MAINGOTT",
        "source_fact_ids": ["F-001"],
    }
    fields.update(overrides)
    return CreativeBrief(**fields)  # type: ignore[arg-type]


def _beat(
    order: int,
    kind: BeatKind = BeatKind.FACTUAL,
    narration: str = "MainGott соединяет каналы в одну систему.",
    on_screen_text: str = "MAINGOTT",
    seconds: float = 8.0,
    claims: list[ClaimReference] | None = None,
) -> ScriptBeat:
    if claims is None and kind is not BeatKind.FRAMING:
        claims = [ClaimReference(claim=narration, source_fact_ids=["F-001"])]
    return ScriptBeat(
        id=f"B-{order:02d}",
        order=order,
        kind=kind,
        purpose="показать систему",
        narration=narration,
        on_screen_text=on_screen_text,
        visual_direction="тёмная сцена, спокойное движение камеры",
        estimated_seconds=seconds,
        claims=claims or [],
    )


def _valid_beats() -> list[ScriptBeat]:
    return [
        _beat(
            1,
            BeatKind.FRAMING,
            narration="Клиенты приходят отовсюду.",
            on_screen_text="Разные каналы",
            claims=[],
        ),
        _beat(2, claims=[ClaimReference(claim="Единая платформа.", source_fact_ids=["F-001"])]),
        _beat(3, claims=[ClaimReference(claim="Каналы объединены.", source_fact_ids=["F-002"])]),
        _beat(
            4,
            claims=[
                ClaimReference(claim="Путь клиента связан.", source_fact_ids=["F-005", "F-003"])
            ],
        ),
        _beat(5, BeatKind.BRAND, seconds=8.0),
    ]


def _policy(**overrides: object) -> ClaimPolicy:
    fields: dict[str, object] = {
        "target_duration_seconds": 40,
        "language": Language.RU,
        "offered_fact_ids": ALL_OFFERED,
    }
    fields.update(overrides)
    return ClaimPolicy(**fields)  # type: ignore[arg-type]


def _names(report: object) -> set[str]:
    return {check.name for check in report.failures}  # type: ignore[attr-defined]


# --- valid plans ---------------------------------------------------------


def test_a_well_sourced_plan_passes(registry: FactRegistry):
    report = validate_plan(_valid_beats(), _brief(), registry, _policy())
    assert report.passed, report.failures


def test_one_claim_may_cite_several_facts(registry: FactRegistry):
    beats = _valid_beats()
    report = validate_plan(beats, _brief(), registry, _policy())
    multi = [claim for beat in beats for claim in beat.claims if len(claim.source_fact_ids) > 1]
    assert multi
    assert report.passed


def test_every_check_is_reported(registry: FactRegistry):
    report = validate_plan(_valid_beats(), _brief(), registry, _policy())
    assert len(report.checks) >= 12
    assert all(check.passed for check in report.checks)


# --- fact traceability ---------------------------------------------------


def test_fabricated_fact_id_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [ClaimReference(claim="Выдумка.", source_fact_ids=["F-404"])]
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "facts_exist" in _names(report)


def test_unsupported_fact_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(claim="Тысячи компаний уже с нами.", source_fact_ids=["F-901"])
    ]
    report = validate_plan(beats, _brief(), registry, _policy(offered_fact_ids=frozenset()))
    assert not report.passed
    assert "no_unsupported_facts" in _names(report)


def test_facts_outside_the_offered_set_are_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [ClaimReference(claim="Аналитика.", source_fact_ids=["F-006"])]
    report = validate_plan(
        beats,
        _brief(),
        registry,
        _policy(offered_fact_ids=frozenset({"F-001", "F-002", "F-005", "F-003"})),
    )
    assert not report.passed
    assert "facts_were_offered" in _names(report)


def test_a_factual_beat_without_claims_cannot_be_built():
    with pytest.raises(Exception, match="must cite at least one fact"):
        _beat(2, BeatKind.FACTUAL, claims=[])


def test_a_plan_resting_on_too_few_facts_is_rejected(registry: FactRegistry):
    beats = [
        _beat(
            1,
            BeatKind.FRAMING,
            narration="Клиенты приходят отовсюду.",
            on_screen_text="Разные каналы",
            claims=[],
        ),
        _beat(2, seconds=18.0),
        _beat(3, BeatKind.BRAND, seconds=18.0),
    ]
    report = validate_plan(beats, _brief(), registry, _policy(min_beats=3))
    assert not report.passed
    assert "fact_coverage" in _names(report)


# --- target facts --------------------------------------------------------


def test_target_fact_is_rejected_when_targets_are_not_allowed(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(
            claim="Платформа спроектирована отвечать за 60 секунд.",
            kind=ClaimKind.TARGET,
            source_fact_ids=["F-900"],
        )
    ]
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "target_facts_not_presented_as_achieved" in _names(report)


def test_target_fact_presented_as_achieved_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(
            claim="MainGott отвечает за 60 секунд.",
            kind=ClaimKind.FACTUAL,
            source_fact_ids=["F-900"],
        )
    ]
    report = validate_plan(
        beats,
        _brief(),
        registry,
        _policy(allow_target_facts=True, offered_fact_ids=ALL_OFFERED | {"F-900"}),
    )
    assert not report.passed
    assert "target_facts_not_presented_as_achieved" in _names(report)


def test_target_claim_without_target_wording_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(
            claim="Ответ приходит за 60 секунд.",
            kind=ClaimKind.TARGET,
            source_fact_ids=["F-900"],
        )
    ]
    report = validate_plan(
        beats,
        _brief(),
        registry,
        _policy(allow_target_facts=True, offered_fact_ids=ALL_OFFERED | {"F-900"}),
    )
    assert not report.passed
    assert "target_facts_not_presented_as_achieved" in _names(report)


def test_target_claim_with_preserved_wording_is_accepted(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(
            claim="Целевое время первого ответа заложено в архитектуру платформы.",
            kind=ClaimKind.TARGET,
            source_fact_ids=["F-900"],
        )
    ]
    report = validate_plan(
        beats,
        _brief(),
        registry,
        _policy(allow_target_facts=True, offered_fact_ids=ALL_OFFERED | {"F-900"}),
    )
    assert report.passed, report.failures


def test_target_claim_that_also_says_already_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference(
            claim="Целевое время ответа уже достигнуто.",
            kind=ClaimKind.TARGET,
            source_fact_ids=["F-900"],
        )
    ]
    report = validate_plan(
        beats,
        _brief(),
        registry,
        _policy(allow_target_facts=True, offered_fact_ids=ALL_OFFERED | {"F-900"}),
    )
    assert not report.passed


# --- framing, language and quality --------------------------------------


def test_framing_beat_may_not_name_maingott(registry: FactRegistry):
    beats = _valid_beats()
    beats[0].narration = "MainGott знает, что клиенты приходят отовсюду."
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "beats_cite_facts" in _names(report)


def test_framing_beat_may_not_contain_numbers(registry: FactRegistry):
    beats = _valid_beats()
    beats[0].narration = "Клиенты приходят из 7 каналов."
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "beats_cite_facts" in _names(report)


@pytest.mark.parametrize(
    "narration",
    [
        "MainGott — лучшая платформа для продаж.",
        "Мы гарантируем результат каждому клиенту.",
        "Это революционная система управления.",
        "Процессы автоматизированы на 100%.",
        "MainGott is the world's best sales system.",
    ],
)
def test_superlatives_are_rejected(registry: FactRegistry, narration: str):
    beats = _valid_beats()
    beats[1].narration = narration
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "no_unsupported_superlatives" in _names(report)


def test_improvement_wording_is_not_mistaken_for_a_superlative(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].narration = "Улучшение процессов продаж становится измеримым."
    report = validate_plan(beats, _brief(), registry, _policy())
    assert "no_unsupported_superlatives" not in _names(report)


@pytest.mark.parametrize(
    "narration",
    [
        "Меня зовут Анна, я расскажу о платформе.",
        "Наш основатель построил эту систему.",
        "Our founder built this platform.",
    ],
)
def test_team_introductions_are_rejected(registry: FactRegistry, narration: str):
    beats = _valid_beats()
    beats[1].narration = narration
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "no_team_members" in _names(report)


def test_placeholder_text_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].on_screen_text = "TODO: подобрать заголовок"
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "no_placeholder_text" in _names(report)


# --- shape and timing ----------------------------------------------------


def test_plan_outside_the_duration_window_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    for beat in beats:
        beat.estimated_seconds = 2.0
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "duration_within_bounds" in _names(report)


def test_too_few_beats_are_rejected(registry: FactRegistry):
    beats = _valid_beats()[:3]
    beats[0].estimated_seconds = 14.0
    beats[1].estimated_seconds = 13.0
    beats[2].estimated_seconds = 13.0
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "beat_count" in _names(report)


def test_unspeakable_narration_is_rejected(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].narration = "Слишком длинная строка, которую невозможно произнести за это время." * 2
    beats[1].estimated_seconds = 2.0
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "speech_rate" in _names(report)


def test_failure_feedback_lists_failed_checks(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [ClaimReference(claim="Выдумка.", source_fact_ids=["F-404"])]
    report = validate_plan(beats, _brief(), registry, _policy())
    feedback = failure_feedback(report)
    assert "facts_exist" in feedback
    assert "F-404" in feedback


# --- defence in depth ----------------------------------------------------
#
# The models already reject these shapes. The validator checks them again,
# because a future change to the models must not silently disable a claims
# policy rule. ``model_construct`` bypasses validation to simulate that.


def test_validator_catches_a_claim_without_fact_ids(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference.model_construct(
            claim="Без источников.", kind=ClaimKind.FACTUAL, source_fact_ids=[]
        )
    ]
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "claims_have_sources" in _names(report)


def test_validator_catches_an_empty_claim_text(registry: FactRegistry):
    beats = _valid_beats()
    beats[1].claims = [
        ClaimReference.model_construct(
            claim="   ", kind=ClaimKind.FACTUAL, source_fact_ids=["F-001"]
        )
    ]
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "claims_have_sources" in _names(report)


def test_validator_catches_a_framing_beat_that_carries_claims(registry: FactRegistry):
    beats = _valid_beats()
    beats[0] = beats[0].model_construct(
        **{
            **beats[0].__dict__,
            "claims": [ClaimReference(claim="Единая платформа.", source_fact_ids=["F-001"])],
        }
    )
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "beats_cite_facts" in _names(report)


def test_validator_catches_a_factual_beat_without_claims(registry: FactRegistry):
    beats = _valid_beats()
    beats[1] = beats[1].model_construct(**{**beats[1].__dict__, "claims": []})
    report = validate_plan(beats, _brief(), registry, _policy())
    assert not report.passed
    assert "beats_cite_facts" in _names(report)


def test_the_brief_is_checked_too(registry: FactRegistry):
    brief = _brief(
        core_message="Лучшая платформа. TODO",
        objective="Наш основатель представляет платформу для бизнеса.",
        cta="Гарантируем результат",
    )
    report = validate_plan(_valid_beats(), brief, registry, _policy())
    failed = _names(report)
    assert "no_unsupported_superlatives" in failed
    assert "no_team_members" in failed
    assert "no_placeholder_text" in failed
