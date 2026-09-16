"""Rehearsal performer positions, performer_marks and mark assertions."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from typer.testing import CliRunner

from cueforge.cli.main import app
from cueforge.compiler.plan import compile_production_document
from cueforge.findings import Severity
from cueforge.production.build import production_from_mapping
from cueforge.simulation import DelayCue, FailCue, GoCue, run_rehearsal

runner = CliRunner()

LOCATIONS = {"sl": {"x": 0, "y": 0}, "c": {"x": 8, "y": 0}, "sr": {"x": 20, "y": 0}}
PERFORMERS = {"mira": {"initial_mark": "sl"}, "joe": {"initial_mark": "sr"}}
SL_TO_C = 5715
C_TO_SR = 8572


def move(
    cue_id: str,
    trigger: dict[str, Any],
    to: str,
    from_mark: str | None = None,
) -> dict[str, Any]:
    action: dict[str, Any] = {"move": "mira", "to": to, "maximum_speed": "1.4"}
    if from_mark is not None:
        action["from"] = from_mark
    return {"id": cue_id, "department": "stage", "trigger": trigger, "action": action}


def light(cue_id: str, at: int) -> dict[str, Any]:
    return {"id": cue_id, "department": "lighting", "trigger": {"at": at}, "duration": 10}


def production(cues: list[dict[str, Any]], assertions: list[str] = ()) -> dict[str, Any]:
    return {
        "version": 1,
        "production": "marks",
        "time_unit": "ms",
        "performers": dict(PERFORMERS),
        "locations": dict(LOCATIONS),
        "cues": cues,
        "assertions": [{"expression": text} for text in assertions],
    }


def compiled(data: dict[str, Any]):
    parsed, findings = production_from_mapping(data, "memory")
    assert parsed is not None, findings
    show, compile_findings = compile_production_document(parsed)
    assert show is not None, compile_findings
    return show


def rehearsed(data: dict[str, Any], interventions: list[Any] | None = None):
    return run_rehearsal(compiled(data), interventions or [])


def codes_of(result: Any) -> list[str]:
    return [item.code for item in result.findings]


def subjects_of(result: Any, code: str) -> list[str | None]:
    return sorted(item.subject_id for item in result.findings if item.code == code)


def status_of(result: Any, cue_id: str) -> Any:
    return next(item for item in result.statuses if item.cue_id == cue_id)


# mira crosses to centre at one second and on to stage right at eight.
def two_moves() -> dict[str, Any]:
    return production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr")])


def test_performer_marks_after_the_rehearsal() -> None:
    result = rehearsed(two_moves())
    assert codes_of(result) == []
    assert result.performer_marks == {"joe": "sr", "mira": "sr"}


def test_json_report_carries_performer_marks(tmp_path: Path) -> None:
    path = tmp_path / "marks.yaml"
    path.write_text(
        "version: 1\nproduction: marks\ntime_unit: ms\n"
        "performers:\n  mira: {initial_mark: sl}\n  joe: {initial_mark: sr}\n"
        "locations:\n  sl: {x: 0, y: 0}\n  c: {x: 8, y: 0}\n  sr: {x: 20, y: 0}\n"
        "cues:\n"
        "  - id: b\n    department: stage\n    trigger: {at: 1000}\n"
        "    action: {move: mira, to: c, maximum_speed: 1.4}\n",
        encoding="utf-8",
    )
    result = runner.invoke(app, ["rehearse", str(path), "--format", "json"])
    assert result.exit_code == 0
    assert '"performer_marks":{"joe":"sr","mira":"c"}' in result.stdout


def test_a_delay_reorders_the_moves_and_flags_both() -> None:
    result = rehearsed(two_moves(), [DelayCue("b", 8000)])
    assert subjects_of(result, "CF5004") == ["a", "b"]
    assert all(item.severity == Severity.ERROR for item in result.findings if item.code == "CF5004")
    a = status_of(result, "a")
    b = status_of(result, "b")
    assert (a.start_ms, a.end_ms) == (8000, 8000 + C_TO_SR)
    assert (b.start_ms, b.end_ms) == (9000, 9000 + SL_TO_C)
    assert result.performer_marks["mira"] == "sr"


def test_a_delay_that_keeps_the_order_is_silent() -> None:
    result = rehearsed(two_moves(), [DelayCue("b", 1000)])
    assert "CF5004" not in codes_of(result)
    assert result.performer_marks["mira"] == "sr"


def test_a_fail_before_start_leaves_the_performer_on_the_first_mark() -> None:
    result = rehearsed(two_moves(), [FailCue("b")])
    assert subjects_of(result, "CF5004") == ["a"]
    assert status_of(result, "b").status == "failed"
    assert status_of(result, "a").status == "completed"
    assert result.performer_marks["mira"] == "sr"


def test_a_fail_mid_run_leaves_the_performer_where_it_was() -> None:
    result = rehearsed(two_moves(), [FailCue("a", 9000)])
    assert "CF5004" not in codes_of(result)
    assert status_of(result, "a").status == "failed"
    assert result.performer_marks["mira"] == "c"


def test_go_places_a_manual_move() -> None:
    data = production(
        [move("m", {"manual": True}, "c", from_mark="sl"), move("a", {"at": 8000}, "sr", from_mark="c")]
    )
    show = compiled(data)
    early = run_rehearsal(show, [GoCue("m", 500)])
    assert "CF5004" not in codes_of(early)
    assert early.performer_marks["mira"] == "sr"
    late = run_rehearsal(show, [GoCue("m", 7000)])
    assert subjects_of(late, "CF5004") == ["a"]
    assert late.performer_marks["mira"] == "sr"
    idle = run_rehearsal(show)
    assert status_of(idle, "m").status == "pending"
    assert subjects_of(idle, "CF5004") == ["a"]


def test_pending_manual_move_keeps_the_initial_mark() -> None:
    result = rehearsed(production([move("m", {"manual": True}, "c", from_mark="sl")]))
    assert "CF5004" not in codes_of(result)
    assert result.performer_marks == {"joe": "sr", "mira": "sl"}


def test_mark_assertion_holds_after_the_move() -> None:
    passing = rehearsed(production([move("b", {"at": 1000}, "c")], ["mira.mark == c at b.completed"]))
    assert "CF6001" not in codes_of(passing)
    assert "CF6003" not in codes_of(passing)
    failing = rehearsed(production([move("b", {"at": 1000}, "c")], ["mira.mark == sl at b.completed"]))
    assert "CF6001" in codes_of(failing)


def test_mark_assertion_fails_while_moving() -> None:
    at_start = rehearsed(production([move("b", {"at": 1000}, "c")], ["mira.mark == sl at b.started"]))
    assert "CF6001" in codes_of(at_start)
    destination = rehearsed(production([move("b", {"at": 1000}, "c")], ["mira.mark == c at b.visible"]))
    assert "CF6001" in codes_of(destination)


def test_mark_assertion_sees_the_initial_mark() -> None:
    cues = [light("z", 0), move("b", {"at": 1000}, "c")]
    result = rehearsed(production(cues, ["mira.mark == sl at z.visible"]))
    assert codes_of(result) == []
    elsewhere = rehearsed(production(cues, ["mira.mark == c at z.visible"]))
    assert codes_of(elsewhere) == ["CF6001"]


def test_arrival_instant_counts_as_arrived() -> None:
    arrived = rehearsed(
        production(
            [light("x", 1000 + SL_TO_C), move("b", {"at": 1000}, "c")],
            ["mira.mark == c at x.visible"],
        )
    )
    assert codes_of(arrived) == []
    still_moving = rehearsed(
        production(
            [light("x", 1000 + SL_TO_C - 1), move("b", {"at": 1000}, "c")],
            ["mira.mark == c at x.visible"],
        )
    )
    assert codes_of(still_moving) == ["CF6001"]


def test_mark_assertion_at_a_fail_instant() -> None:
    show = compiled(production([move("b", {"at": 1000}, "c")], ["mira.mark == sl at b.failed"]))
    before_start = run_rehearsal(show, [FailCue("b")])
    assert [item.code for item in before_start.findings if item.code.startswith("CF6")] == []
    stopped = run_rehearsal(show, [FailCue("b", 3000)])
    assert [item.code for item in stopped.findings if item.code.startswith("CF6")] == []
    assert stopped.performer_marks["mira"] == "sl"
    mid_move = compiled(
        production([light("x", 2000), move("b", {"at": 1000}, "c")], ["mira.mark == sl at x.visible"])
    )
    assert "CF6001" in codes_of(run_rehearsal(mid_move, [FailCue("b", 3000)]))


def test_performer_marks_without_any_move() -> None:
    result = rehearsed(production([light("z", 0)]))
    assert result.performer_marks == {"joe": "sr", "mira": "sl"}
    assert codes_of(result) == []


def test_rehearsal_flags_the_running_move_case_too() -> None:
    data = production([move("b", {"at": 1000}, "c"), move("a", {"at": 7000}, "sr")])
    show = compiled(data)
    assert subjects_of(run_rehearsal(show), "CF5004") == []
    delayed = run_rehearsal(show, [DelayCue("b", 500)])
    assert subjects_of(delayed, "CF5004") == ["a"]
    a = status_of(delayed, "a")
    assert (a.start_ms, a.end_ms) == (7000, 7000 + C_TO_SR)
    assert delayed.performer_marks["mira"] == "sr"


def test_mark_assertion_follows_delays() -> None:
    data = production([light("x", 7000), move("b", {"at": 1000}, "c")], ["mira.mark == c at x.visible"])
    show = compiled(data)
    on_time = run_rehearsal(show)
    assert "CF6001" not in codes_of(on_time)
    delayed = run_rehearsal(show, [DelayCue("b", 1000)])
    assert "CF6001" in codes_of(delayed)


def test_mark_assertion_unknown_subjects() -> None:
    nobody = rehearsed(production([move("b", {"at": 1000}, "c")], ["nobody.mark == c at b.completed"]))
    assert "CF6003" in codes_of(nobody)
    nowhere = rehearsed(production([move("b", {"at": 1000}, "c")], ["mira.mark == moon at b.completed"]))
    assert "CF6003" in codes_of(nowhere)
    assert "CF6002" not in codes_of(nowhere)


def test_compile_time_disagreement_is_settled_by_the_real_position() -> None:
    # The compiler already flags the stated mark and departs from the real one,
    # so a rehearsal that keeps the order has nothing further to report.
    data = production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr", from_mark="sl")])
    show = compiled(data)
    assert show.cue_map()["a"].action["from"] == "c"
    result = run_rehearsal(show)
    assert subjects_of(result, "CF5004") == []
    assert result.performer_marks["mira"] == "sr"


def test_two_performers_are_followed_apart_in_a_rehearsal() -> None:
    tomas = {
        "id": "t",
        "department": "stage",
        "trigger": {"at": 1000},
        "action": {"move": "joe", "to": "c", "maximum_speed": "1.4"},
    }
    data = production(
        [move("b", {"at": 1000}, "c"), tomas, light("x", 10000)],
        ["joe.mark == c at x.visible", "mira.mark == c at x.visible"],
    )
    show = compiled(data)
    on_time = run_rehearsal(show)
    assert codes_of(on_time) == []
    assert on_time.performer_marks == {"joe": "c", "mira": "c"}
    assert status_of(on_time, "t").end_ms == 1000 + C_TO_SR
    # Holding joe back leaves him mid-cross at ten seconds; mira is unaffected.
    held_back = run_rehearsal(show, [DelayCue("t", 5000)])
    assert subjects_of(held_back, "CF5004") == []
    assert [item.subject_id for item in held_back.findings if item.code == "CF6001"] == [
        "joe.mark == c at x.visible"
    ]
    assert held_back.performer_marks == {"joe": "c", "mira": "c"}


def test_cli_fail_flag_leaves_the_performer_where_it_was(tmp_path: Path) -> None:
    path = tmp_path / "marks.yaml"
    path.write_text(
        "version: 1\nproduction: marks\ntime_unit: ms\n"
        "performers:\n  mira: {initial_mark: sl}\n  joe: {initial_mark: sr}\n"
        "locations:\n  sl: {x: 0, y: 0}\n  c: {x: 8, y: 0}\n  sr: {x: 20, y: 0}\n"
        "cues:\n"
        "  - id: b\n    department: stage\n    trigger: {at: 1000}\n"
        "    action: {move: mira, to: c, maximum_speed: 1.4}\n"
        "  - id: a\n    department: stage\n    trigger: {at: 8000}\n"
        "    action: {move: mira, to: sr, maximum_speed: 1.4}\n",
        encoding="utf-8",
    )
    result = runner.invoke(app, ["rehearse", str(path), "--fail", "a", "--format", "json"])
    assert result.exit_code == 1
    assert '"performer_marks":{"joe":"sr","mira":"c"}' in result.stdout


def test_a_go_checks_the_from_the_compiler_had_to_trust() -> None:
    show = compiled(production([move("m", {"manual": True}, "c", from_mark="sr"), light("x", 9000)]))
    fired = run_rehearsal(show, [GoCue("m", 0)])
    assert subjects_of(fired, "CF5004") == ["m"]
    assert fired.performer_marks["mira"] == "c"


def test_mark_assertion_waits_for_the_go() -> None:
    data = production(
        [move("m", {"manual": True}, "c", from_mark="sl"), light("x", 9000)],
        ["mira.mark == c at x.visible"],
    )
    show = compiled(data)
    assert "CF6001" not in codes_of(run_rehearsal(show, [GoCue("m", 0)]))
    assert "CF6001" in codes_of(run_rehearsal(show))
    assert "CF6001" in codes_of(run_rehearsal(show, [GoCue("m", 5000)]))


def test_the_move_that_finishes_last_decides_the_mark() -> None:
    data = production(
        [move("b", {"at": 1000}, "c"), move("a", {"at": 3000}, "sr"), light("x", 1000 + SL_TO_C)],
        ["mira.mark == c at x.visible"],
    )
    result = rehearsed(data)
    assert "CF6001" in codes_of(result)
    assert result.performer_marks["mira"] == "sr"
    a = status_of(result, "a")
    b = status_of(result, "b")
    assert a.end_ms is not None and b.end_ms is not None
    assert a.end_ms > b.end_ms
