"""How a hold is reported: the CF7001 finding, the holds list, events, digests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from cueforge import compile_production, load_production, rehearse
from cueforge.compiler.plan import compile_production_document
from cueforge.findings import Severity
from cueforge.production.build import production_from_mapping
from cueforge.reports.canonical_json import canonical_dumps

ROOT = Path(__file__).resolve().parents[2]


def cue(
    cue_id: str,
    at: int | None = None,
    *,
    after: str | None = None,
    offset: int = 0,
    duration: int = 1000,
    uses: tuple[str, ...] = (),
) -> dict[str, Any]:
    trigger: dict[str, Any] = (
        {"after": after, "offset": offset} if after is not None else {"at": at if at is not None else 0}
    )
    return {
        "id": cue_id,
        "department": "video",
        "trigger": trigger,
        "duration": duration,
        "uses": list(uses),
    }


def build(cues: list[dict[str, Any]], resources: dict[str, dict[str, Any]]) -> Any:
    data = {
        "version": 1,
        "production": "reports",
        "time_unit": "ms",
        "resources": resources,
        "cues": cues,
    }
    production, findings = production_from_mapping(data, "memory")
    assert production is not None, findings
    show, compile_findings = compile_production_document(production)
    assert show is not None, compile_findings
    return show


def devices(*names: str) -> dict[str, dict[str, Any]]:
    return {name: {"kind": "device", "capacity": 1} for name in names}


def one_hold() -> Any:
    return build(
        [cue("a", 0, duration=5000, uses=("proj",)), cue("b", 2000, duration=5000, uses=("proj",))],
        devices("proj"),
    )


class TestFinding:
    def test_late_start_is_one_warning_per_cue(self) -> None:
        result = rehearse(one_hold())
        late = [item for item in result.findings if item.code == "CF7001"]
        assert len(late) == 1
        finding = late[0]
        assert finding.severity == Severity.WARNING
        assert finding.subject_kind == "cue"
        assert finding.subject_id == "b"
        assert dict(finding.witness) == {
            "planned_ms": 2000,
            "start_ms": 5000,
            "held_ms": 3000,
            "resources": "proj",
        }

    def test_no_finding_without_a_late_start(self) -> None:
        show = build(
            [cue("a", 0, duration=5000, uses=("proj",)), cue("b", 5000, duration=100, uses=("proj",))],
            devices("proj"),
        )
        result = rehearse(show)
        assert "CF7001" not in [item.code for item in result.findings]
        assert result.semantic_dict()["holds"] == []

    def test_witness_lists_only_the_resources_without_a_slot(self) -> None:
        show = build(
            [
                cue("h", 0, duration=5000, uses=("proj",)),
                cue("w", 1000, duration=100, uses=("wall", "proj", "lamp")),
            ],
            devices("proj", "wall", "lamp"),
        )
        result = rehearse(show)
        finding = next(item for item in result.findings if item.code == "CF7001")
        assert finding.witness["resources"] == "proj"
        assert result.semantic_dict()["holds"][0]["resources"] == ["proj"]

    def test_witness_resources_are_sorted_and_comma_joined(self) -> None:
        show = build(
            [
                cue("h1", 0, duration=5000, uses=("zed",)),
                cue("h2", 0, duration=4000, uses=("alpha",)),
                cue("w", 1000, duration=100, uses=("zed", "alpha")),
            ],
            devices("zed", "alpha"),
        )
        result = rehearse(show)
        finding = next(item for item in result.findings if item.code == "CF7001")
        assert finding.witness["resources"] == "alpha,zed"
        assert finding.witness["start_ms"] == 5000
        assert result.semantic_dict()["holds"][0]["resources"] == ["alpha", "zed"]

    def test_a_hold_is_never_an_error(self) -> None:
        result = rehearse(one_hold())
        assert result.findings
        assert all(item.severity != Severity.ERROR for item in result.findings)


class TestHoldsList:
    def test_entry_shape(self) -> None:
        result = rehearse(one_hold())
        assert result.semantic_dict()["holds"] == [
            {"cue_id": "b", "held_ms": 3000, "planned_ms": 2000, "resources": ["proj"], "start_ms": 5000}
        ]

    def test_entries_are_ordered_by_planned_instant_then_cue_id(self) -> None:
        show = build(
            [
                cue("h", 0, duration=5000, uses=("proj",)),
                cue("zeta", 1000, duration=100, uses=("proj",)),
                cue("alpha", 1000, duration=100, uses=("proj",)),
                cue("early", 500, duration=100, uses=("proj",)),
                cue("later", 4000, duration=100, uses=("lamp",)),
                cue("lamp_holder", 0, duration=4500, uses=("lamp",)),
            ],
            devices("proj", "lamp"),
        )
        result = rehearse(show)
        entries = result.semantic_dict()["holds"]
        assert [(item["cue_id"], item["planned_ms"]) for item in entries] == [
            ("early", 500),
            ("alpha", 1000),
            ("zeta", 1000),
            ("later", 4000),
        ]
        assert [item["start_ms"] for item in entries] == [5000, 5100, 5200, 4500]

    def test_holds_present_and_empty_when_nothing_waited(self) -> None:
        loaded = load_production(ROOT / "examples" / "concert_two_looks.yaml")
        compiled = compile_production(loaded.value)
        assert compiled.value is not None
        result = rehearse(compiled.value)
        assert result.semantic_dict()["holds"] == []


class TestEventsAndStatuses:
    def test_eligible_at_planned_and_started_at_actual(self) -> None:
        result = rehearse(one_hold())
        by_kind = {(event.cue_id, event.kind): event.time_ms for event in result.events}
        assert by_kind[("b", "eligible")] == 2000
        assert by_kind[("b", "started")] == 5000
        assert by_kind[("b", "resource_reserved")] == 5000
        assert by_kind[("b", "completed")] == 10000
        kinds = sorted({event.kind for event in result.events})
        assert kinds == ["completed", "eligible", "resource_released", "resource_reserved", "started"]

    def test_started_event_carries_the_cue_duration(self) -> None:
        result = rehearse(one_hold())
        started = next(event for event in result.events if event.cue_id == "b" and event.kind == "started")
        assert started.time_ms == 5000
        assert dict(started.details) == {"duration_ms": 5000}

    def test_events_at_the_release_instant_follow_the_documented_order(self) -> None:
        result = rehearse(one_hold())
        at_5000 = [(event.kind, event.cue_id) for event in result.events if event.time_ms == 5000]
        assert at_5000 == [
            ("started", "b"),
            ("resource_reserved", "b"),
            ("completed", "a"),
            ("resource_released", "a"),
        ]

    def test_statuses_report_the_actual_start(self) -> None:
        result = rehearse(one_hold())
        statuses = {item["cue_id"]: item for item in result.semantic_dict()["statuses"]}
        assert statuses["b"] == {"cue_id": "b", "end_ms": 10000, "fail_ms": None, "start_ms": 5000, "status": "completed"}

    def test_a_dependent_of_a_held_cue_is_eligible_when_called(self) -> None:
        show = build(
            [
                cue("h", 0, duration=5000, uses=("proj",)),
                cue("w", 1000, duration=100, uses=("proj",)),
                cue("d", after="w", offset=250, duration=100),
            ],
            devices("proj"),
        )
        result = rehearse(show)
        d_events = [(event.kind, event.time_ms) for event in result.events if event.cue_id == "d"]
        assert d_events == [("eligible", 5250), ("started", 5250), ("completed", 5350)]


class TestDeterminism:
    def test_repeated_rehearsal_with_holds_is_byte_identical(self) -> None:
        show = one_hold()
        first = rehearse(show)
        second = rehearse(show)
        assert first.digest == second.digest
        assert canonical_dumps(first.semantic_dict()) == canonical_dumps(second.semantic_dict())
        assert [item["cue_id"] for item in first.semantic_dict()["holds"]] == ["b"]


class TestDocumentation:
    def test_timing_contract_documents_holds(self) -> None:
        text = (ROOT / "docs" / "timing-contract.md").read_text(encoding="utf-8")
        assert "CF7001" in text
        assert "hold" in text.lower()

    def test_changelog_notes_the_change(self) -> None:
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        assert "CF7001" in text
