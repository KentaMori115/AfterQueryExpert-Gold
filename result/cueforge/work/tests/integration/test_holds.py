"""Rehearsal holds: a cue whose resources have no free slot waits for one."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from typer.testing import CliRunner

from cueforge import compile_production, load_production, rehearse
from cueforge.cli.main import app
from cueforge.compiler.plan import compile_production_document
from cueforge.production.build import production_from_mapping
from cueforge.simulation import DelayCue, FailCue, GoCue

ROOT = Path(__file__).resolve().parents[2]
OVERLAP = ROOT / "examples" / "invalid-productions" / "overlap.yaml"
runner = CliRunner()


def cue(
    cue_id: str,
    *,
    at: int | None = None,
    after: str | None = None,
    on: str | None = None,
    manual: bool = False,
    offset: int = 0,
    duration: int = 1000,
    uses: tuple[str, ...] = (),
    requires: list[dict[str, str]] | None = None,
    action: dict[str, str] | None = None,
) -> dict[str, Any]:
    trigger: dict[str, Any]
    if after is not None:
        trigger = {"after": after, "offset": offset}
    elif on is not None:
        trigger = {"on": on, "offset": offset}
    elif manual:
        trigger = {"manual": True}
    else:
        trigger = {"at": at if at is not None else 0}
    body: dict[str, Any] = {
        "id": cue_id,
        "department": "stage",
        "trigger": trigger,
        "duration": duration,
        "uses": list(uses),
    }
    if requires is not None:
        body["requires"] = requires
    if action is not None:
        body["action"] = action
    return body


def exclusive(*names: str, capacity: int = 1) -> dict[str, dict[str, Any]]:
    return {name: {"kind": "device", "capacity": capacity} for name in names}


def build(
    cues: list[dict[str, Any]],
    resources: dict[str, dict[str, Any]] | None = None,
    events: dict[str, int] | None = None,
    assertions: list[str] = (),  # type: ignore[assignment]
) -> Any:
    data: dict[str, Any] = {
        "version": 1,
        "production": "holds",
        "time_unit": "ms",
        "resources": resources or {},
        "events": events or {},
        "cues": cues,
        "assertions": [{"expression": text} for text in assertions],
    }
    production, findings = production_from_mapping(data, "memory")
    assert production is not None, findings
    show, compile_findings = compile_production_document(production)
    assert show is not None, compile_findings
    return show


def starts(result: Any) -> dict[str, int | None]:
    return {item.cue_id: item.start_ms for item in result.statuses}


def ends(result: Any) -> dict[str, int | None]:
    return {item.cue_id: item.end_ms for item in result.statuses}


def status_of(result: Any) -> dict[str, str]:
    return {item.cue_id: item.status for item in result.statuses}


def codes(result: Any) -> list[str]:
    return [item.code for item in result.findings]


def holds(result: Any) -> list[dict[str, Any]]:
    return list(result.semantic_dict()["holds"])


class TestSlotsAndReleases:
    def test_busy_resource_holds_the_cue_until_the_holder_completes(self) -> None:
        show = build(
            [cue("a", at=0, duration=5000, uses=("proj",)), cue("b", at=2000, duration=5000, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"a": 0, "b": 5000}
        assert ends(result) == {"a": 5000, "b": 10000}
        assert status_of(result) == {"a": "completed", "b": "completed"}
        assert "CF4001" not in codes(result)
        assert "CF4002" not in codes(result)
        assert codes(result).count("CF7001") == 1

    def test_release_at_the_called_instant_is_not_a_hold(self) -> None:
        show = build(
            [cue("a", at=0, duration=5000, uses=("proj",)), cue("b", at=5000, duration=100, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"a": 0, "b": 5000}
        assert holds(result) == []
        assert "CF7001" not in codes(result)
        # the same production one millisecond earlier is a genuine hold
        early = rehearse(
            build(
                [cue("a", at=0, duration=5000, uses=("proj",)), cue("b", at=4999, duration=100, uses=("proj",))],
                exclusive("proj"),
            )
        )
        assert starts(early) == {"a": 0, "b": 5000}
        assert [item["cue_id"] for item in holds(early)] == ["b"]

    def test_capacity_counts_started_holders(self) -> None:
        show = build(
            [
                cue("a", at=0, duration=5000, uses=("radio",)),
                cue("b", at=0, duration=3000, uses=("radio",)),
                cue("c", at=1000, duration=100, uses=("radio",)),
            ],
            exclusive("radio", capacity=2),
        )
        result = rehearse(show)
        assert starts(result) == {"a": 0, "b": 0, "c": 3000}
        assert holds(result) == [
            {"cue_id": "c", "held_ms": 2000, "planned_ms": 1000, "resources": ["radio"], "start_ms": 3000}
        ]
        assert "CF4002" not in codes(result)

    def test_a_cue_that_failed_before_starting_holds_no_slot(self) -> None:
        show = build(
            [cue("a", at=0, duration=9000, uses=("proj",)), cue("b", at=1000, duration=100, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show, [FailCue("a")])
        assert status_of(result) == {"a": "failed", "b": "completed"}
        assert starts(result)["b"] == 1000
        assert holds(result) == []

    def test_failure_while_running_releases_the_slot_at_the_failure_instant(self) -> None:
        show = build(
            [cue("a", at=0, duration=9000, uses=("proj",)), cue("b", at=1000, duration=100, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show, [FailCue("a", 4000)])
        assert status_of(result) == {"a": "failed", "b": "completed"}
        assert starts(result) == {"a": 0, "b": 4000}
        assert holds(result) == [
            {"cue_id": "b", "held_ms": 3000, "planned_ms": 1000, "resources": ["proj"], "start_ms": 4000}
        ]
        assert "CF7002" in codes(result)

    def test_every_used_resource_needs_a_free_slot(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("r1",)),
                cue("w", at=1000, duration=100, uses=("r1", "r2")),
                cue("x", at=3000, duration=5000, uses=("r2",)),
            ],
            exclusive("r1", "r2"),
        )
        result = rehearse(show)
        # x takes r2 while w is still waiting for r1; w then waits for r2 too
        assert starts(result) == {"h": 0, "w": 8000, "x": 3000}
        assert holds(result) == [
            {"cue_id": "w", "held_ms": 7000, "planned_ms": 1000, "resources": ["r1"], "start_ms": 8000}
        ]

    def test_a_held_cue_holds_nothing_while_it_waits(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("r1",)),
                cue("w", at=1000, duration=4000, uses=("r1", "r2")),
                cue("x", at=2000, duration=1000, uses=("r2",)),
            ],
            exclusive("r1", "r2"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "w": 5000, "x": 2000}
        assert [item["cue_id"] for item in holds(result)] == ["w"]


class TestEntitlementOrder:
    def test_earlier_planned_instant_wins_the_freed_slot(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("a_late", at=5000, duration=100, uses=("proj",)),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "w": 5000, "a_late": 5100}
        assert [(item["cue_id"], item["planned_ms"], item["start_ms"]) for item in holds(result)] == [
            ("w", 1000, 5000),
            ("a_late", 5000, 5100),
        ]

    def test_equal_planned_instants_are_ordered_by_cue_id(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("zeta", at=1000, duration=200, uses=("proj",)),
                cue("alpha", at=1000, duration=300, uses=("proj",)),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "alpha": 5000, "zeta": 5300}

    def test_queue_order_follows_planned_instant_not_arrival(self) -> None:
        # ``late`` is declared first and called first among the waiters at
        # 2000; ``early`` is a dependent called at 1500 once ``k`` starts.
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("late", at=2000, duration=100, uses=("proj",)),
                cue("k", at=1000, duration=10),
                cue("early", after="k", offset=500, duration=100, uses=("proj",)),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "k": 1000, "early": 5000, "late": 5100}


class TestDependents:
    def test_non_negative_offset_follows_the_actual_start(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("d", after="w", offset=500, duration=100),
                cue("z", after="w", offset=0, duration=100),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "w": 5000, "d": 5500, "z": 5000}
        assert status_of(result) == {"h": "completed", "w": "completed", "d": "completed", "z": "completed"}
        assert [item["cue_id"] for item in holds(result)] == ["w"]

    def test_negative_offset_keeps_the_planned_instant(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("n", after="w", offset=-200, duration=100),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        assert starts(result) == {"h": 0, "w": 5000, "n": 800}
        assert status_of(result)["n"] == "completed"

    def test_dependent_delay_is_added_to_the_actual_start(self) -> None:
        show = build(
            [
                cue("a", at=0, duration=5000, uses=("proj",)),
                cue("b", at=2000, duration=100, uses=("proj",)),
                cue("d", after="b", offset=100, duration=100),
            ],
            exclusive("proj"),
        )
        result = rehearse(show, [DelayCue("d", 50)])
        assert starts(result) == {"a": 0, "b": 5000, "d": 5150}

    def test_shift_propagates_down_a_chain(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("d1", after="w", offset=100, duration=100),
                cue("d2", after="d1", offset=100, duration=100),
                cue("d3", after="d2", offset=-50, duration=100),
            ],
            exclusive("proj"),
        )
        result = rehearse(show)
        # d3 has a negative offset from d2, so it keeps the instant the plan
        # gave it, while d1 and d2 follow w's actual start
        assert starts(result) == {"h": 0, "w": 5000, "d1": 5100, "d2": 5200, "d3": 1150}

    def test_dependent_of_a_held_dependent_uses_its_own_planned_instant(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("g", at=5100, duration=3000, uses=("lamp",)),
                cue("d", after="w", offset=0, duration=1000, uses=("lamp",)),
            ],
            exclusive("proj", "lamp"),
        )
        result = rehearse(show)
        # d is called at 5000 (w's actual start), ahead of g's 5100
        assert starts(result) == {"h": 0, "w": 5000, "g": 6000, "d": 5000}
        assert [(item["cue_id"], item["planned_ms"], item["held_ms"]) for item in holds(result)] == [
            ("w", 1000, 4000),
            ("g", 5100, 900),
        ]

    def test_dependency_that_fails_before_starting_calls_dependents_from_the_failure(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("d", after="w", offset=300, duration=100),
            ],
            exclusive("proj"),
        )
        result = rehearse(show, [FailCue("w")])
        assert status_of(result) == {"h": "completed", "w": "failed", "d": "completed"}
        assert starts(result)["d"] == 1300
        assert ends(result)["d"] == 1400
        assert holds(result) == []

    def test_absolute_event_and_manual_cues_are_not_moved(self) -> None:
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue("w", at=1000, duration=100, uses=("proj",)),
                cue("abs", at=2000, duration=100),
                cue("evt", on="line_3", offset=-100, duration=100),
                cue("go", manual=True, duration=100),
            ],
            exclusive("proj"),
            events={"line_3": 3000},
        )
        result = rehearse(show, [GoCue("go", 2500)])
        assert starts(result) == {"h": 0, "w": 5000, "abs": 2000, "evt": 2900, "go": 2500}


class TestPlannedInstant:
    def test_delay_moves_the_planned_instant(self) -> None:
        show = build(
            [cue("a", at=0, duration=5000, uses=("proj",)), cue("b", at=1000, duration=100, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show, [DelayCue("b", 1500)])
        assert holds(result) == [
            {"cue_id": "b", "held_ms": 2500, "planned_ms": 2500, "resources": ["proj"], "start_ms": 5000}
        ]

    def test_manual_go_is_the_planned_instant(self) -> None:
        show = build(
            [cue("a", at=0, duration=5000, uses=("proj",)), cue("m", manual=True, duration=100, uses=("proj",))],
            exclusive("proj"),
        )
        result = rehearse(show, [GoCue("m", 3000)])
        assert starts(result) == {"a": 0, "m": 5000}
        assert holds(result) == [
            {"cue_id": "m", "held_ms": 2000, "planned_ms": 3000, "resources": ["proj"], "start_ms": 5000}
        ]

    def test_requires_state_is_checked_when_the_cue_actually_starts(self) -> None:
        resources = {
            "proj": {"kind": "device", "capacity": 1},
            "revolve": {
                "kind": "stage_automation",
                "capacity": 1,
                "states": ["locked", "moving"],
                "initial_state": "locked",
            },
        }
        show = build(
            [
                cue("h", at=0, duration=5000, uses=("proj",)),
                cue(
                    "auto",
                    at=1000,
                    duration=100,
                    uses=("proj",),
                    requires=[{"resource": "revolve", "state": "locked"}],
                ),
                cue(
                    "unlock",
                    at=3000,
                    duration=10,
                    action={"resource": "revolve", "transition_to": "moving"},
                ),
            ],
            resources,
        )
        result = rehearse(show)
        # locked at 1000, moving by the time the slot frees at 5000
        assert status_of(result)["auto"] == "failed"
        assert "CF4003" in codes(result)
        assert holds(result) == []


class TestCommandLine:
    def test_overlap_example_rehearses_with_a_hold(self) -> None:
        loaded = load_production(OVERLAP)
        compiled = compile_production(loaded.value)
        assert any(item.code == "CF4001" for item in compiled.findings)
        assert compiled.value is not None
        result = rehearse(compiled.value)
        assert starts(result) == {"video_a": 0, "video_b": 5000}
        assert "CF4001" not in codes(result)
        assert holds(result) == [
            {
                "cue_id": "video_b",
                "held_ms": 3000,
                "planned_ms": 2000,
                "resources": ["main_projector"],
                "start_ms": 5000,
            }
        ]

    def test_rehearse_exits_zero_when_holds_are_the_only_findings(self) -> None:
        result = runner.invoke(app, ["rehearse", str(OVERLAP), "--format", "json"])
        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert [item["code"] for item in payload["findings"]] == ["CF7001"]
        assert payload["findings"][0]["severity"] == "warning"
        assert payload["holds"] == [
            {
                "cue_id": "video_b",
                "held_ms": 3000,
                "planned_ms": 2000,
                "resources": ["main_projector"],
                "start_ms": 5000,
            }
        ]

    def test_report_json_carries_holds_and_exits_zero(self) -> None:
        result = runner.invoke(app, ["report", str(OVERLAP), "--format", "json"])
        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert [item["cue_id"] for item in payload["holds"]] == ["video_b"]
        statuses = {item["cue_id"]: item["start_ms"] for item in payload["statuses"]}
        assert statuses == {"video_a": 0, "video_b": 5000}

    def test_compile_still_reports_the_plan_conflict_that_rehearse_resolves(self) -> None:
        compiled = runner.invoke(app, ["compile", str(OVERLAP)])
        assert compiled.exit_code == 1
        assert "CF4001" in compiled.stdout
        rehearsed = runner.invoke(app, ["rehearse", str(OVERLAP)])
        assert rehearsed.exit_code == 0
        assert "CF4001" not in rehearsed.stdout
        assert "CF7001" in rehearsed.stdout

    def test_text_rehearsal_names_the_hold(self, tmp_path: Path) -> None:
        production = tmp_path / "show.yaml"
        production.write_text(
            "version: 1\nproduction: two_lamps\ntime_unit: ms\n"
            "resources:\n  lamp:\n    kind: lighting_device\n    capacity: 1\n"
            "cues:\n"
            "  - id: warm\n    department: lighting\n    trigger: {at: 0}\n    duration: 3000\n    uses: [lamp]\n"
            "  - id: cold\n    department: lighting\n    trigger: {at: 1000}\n    duration: 500\n    uses: [lamp]\n",
            encoding="utf-8",
        )
        result = runner.invoke(app, ["rehearse", str(production)])
        assert result.exit_code == 0
        assert "CF7001" in result.stdout
        assert "cold" in result.stdout
        assert "CF4001" not in result.stdout
