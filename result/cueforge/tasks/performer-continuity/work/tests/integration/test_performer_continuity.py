"""Compile-time performer positions: where a move really departs from."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from typer.testing import CliRunner

from cueforge.cli.main import app
from cueforge.compiler.plan import compile_production_document
from cueforge.findings import Severity
from cueforge.production.build import production_from_mapping

runner = CliRunner()

# Stage left, centre and stage right on one line: 8 units, then 12 more.
LOCATIONS = {"sl": {"x": 0, "y": 0}, "c": {"x": 8, "y": 0}, "sr": {"x": 20, "y": 0}}
PERFORMERS = {"mira": {"initial_mark": "sl"}, "joe": {"initial_mark": "sr"}}

# 1.4 units per second: 8 units take 5715 ms, 12 take 8572, 20 take 14286.
SL_TO_C = 5715
C_TO_SR = 8572
SL_TO_SR = 14286


def move(
    cue_id: str,
    trigger: dict[str, Any],
    to: str,
    who: str = "mira",
    from_mark: str | None = None,
    duration: int = 0,
) -> dict[str, Any]:
    action: dict[str, Any] = {"move": who, "to": to, "maximum_speed": "1.4"}
    if from_mark is not None:
        action["from"] = from_mark
    return {
        "id": cue_id,
        "department": "stage",
        "trigger": trigger,
        "duration": duration,
        "action": action,
    }


def light(cue_id: str, at: int) -> dict[str, Any]:
    return {"id": cue_id, "department": "lighting", "trigger": {"at": at}, "duration": 10}


def production(cues: list[dict[str, Any]], **top: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "version": 1,
        "production": "marks",
        "time_unit": "ms",
        "performers": dict(PERFORMERS),
        "locations": dict(LOCATIONS),
        "cues": cues,
    }
    data.update(top)
    return data


def compile_of(data: dict[str, Any]):
    parsed, findings = production_from_mapping(data, "memory")
    assert parsed is not None, findings
    return compile_production_document(parsed)


def compiled(data: dict[str, Any]):
    show, findings = compile_of(data)
    assert show is not None, findings
    return show, findings


def codes_of(findings: Any) -> list[str]:
    return [item.code for item in findings]


def subjects_of(findings: Any, code: str) -> list[str | None]:
    return sorted(item.subject_id for item in findings if item.code == code)


def errors_of(findings: Any) -> list[str]:
    return [item.code for item in findings if item.severity == Severity.ERROR]


def test_omitted_from_departs_from_the_initial_mark() -> None:
    show, findings = compiled(production([move("b", {"at": 1000}, "c")]))
    assert errors_of(findings) == []
    b = show.cue_map()["b"]
    assert b.duration_ms == SL_TO_C
    assert b.action["from"] == "sl"


def test_second_move_departs_where_the_first_ended() -> None:
    # Identifier order puts a first; start order puts b first, and b moves mira.
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr")])
    )
    assert errors_of(findings) == []
    a = show.cue_map()["a"]
    assert a.action["from"] == "c"
    assert a.duration_ms == C_TO_SR


def test_ties_break_by_cue_id() -> None:
    show, findings = compiled(
        production([move("n", {"at": 1000}, "sr"), move("m", {"at": 1000}, "c")])
    )
    m = show.cue_map()["m"]
    n = show.cue_map()["n"]
    assert (m.action["from"], m.duration_ms) == ("sl", SL_TO_C)
    assert (n.action["from"], n.duration_ms) == ("c", C_TO_SR)
    assert subjects_of(findings, "CF5004") == ["n"]


def test_move_during_a_running_move_is_flagged_and_departs_from_its_to() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 3000}, "sr")])
    )
    assert subjects_of(findings, "CF5004") == ["a"]
    assert all(item.severity == Severity.ERROR for item in findings if item.code == "CF5004")
    a = show.cue_map()["a"]
    assert a.action["from"] == "c"
    assert a.duration_ms == C_TO_SR


def test_move_at_the_end_instant_of_a_running_move_is_clean() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 1000 + SL_TO_C}, "sr")])
    )
    assert "CF5004" not in codes_of(findings)
    assert show.cue_map()["a"].action["from"] == "c"


def test_stated_from_that_disagrees_is_flagged_and_ignored_for_travel() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr", from_mark="sl")])
    )
    assert subjects_of(findings, "CF5004") == ["a"]
    a = show.cue_map()["a"]
    assert a.duration_ms == C_TO_SR
    assert a.action["from"] == "c"


def test_omitted_and_correct_from_compile_alike() -> None:
    stated, stated_findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr", from_mark="c")])
    )
    omitted, omitted_findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr")])
    )
    assert errors_of(stated_findings) == []
    assert errors_of(omitted_findings) == []
    assert stated.digest == omitted.digest
    assert stated.cue_map()["a"].action == omitted.cue_map()["a"].action


def test_unknown_initial_mark_is_reported_without_any_move() -> None:
    ghost = {"mira": {"initial_mark": "sl"}, "ghost": {"initial_mark": "nowhere"}}
    _, findings = compile_of(production([light("x", 0)], performers=ghost))
    unknown = [item for item in findings if item.code == "CF5002"]
    assert len(unknown) == 1
    assert unknown[0].severity == Severity.ERROR
    _, clean = compile_of(production([light("x", 0)]))
    assert "CF5002" not in codes_of(clean)


def test_a_manual_move_makes_the_position_unknown() -> None:
    manual = move("m", {"manual": True}, "c", from_mark="sl")
    _, findings = compile_of(production([manual, move("a", {"at": 8000}, "sr")]))
    assert subjects_of(findings, "CF3005") == ["a"]
    assert all(item.severity == Severity.ERROR for item in findings if item.code == "CF3005")
    show, stated = compiled(production([manual, move("a", {"at": 8000}, "sr", from_mark="c")]))
    assert "CF3005" not in codes_of(stated)
    assert show.cue_map()["a"].duration_ms == C_TO_SR
    assert show.cue_map()["m"].duration_ms == SL_TO_C


def test_a_manual_move_needs_its_own_from() -> None:
    _, findings = compile_of(production([move("m", {"manual": True}, "c")]))
    assert subjects_of(findings, "CF3005") == ["m"]
    show, stated = compiled(production([move("m", {"manual": True}, "c", from_mark="sl")]))
    assert errors_of(stated) == []
    assert show.cue_map()["m"].action["from"] == "sl"


def test_duration_rules_use_the_real_position() -> None:
    show, findings = compiled(
        production(
            [
                move("b", {"at": 1000}, "c"),
                move("a", {"at": 8000}, "sr", from_mark="sl", duration=9000),
            ]
        )
    )
    assert "CF5004" in codes_of(findings)
    assert "CF5001" not in codes_of(findings)
    assert show.cue_map()["a"].duration_ms == 9000


def test_authored_duration_shorter_than_the_real_travel() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 8000}, "sr", duration=8000)])
    )
    assert "CF5004" not in codes_of(findings)
    assert subjects_of(findings, "CF5001") == ["a"]
    assert show.cue_map()["a"].action["from"] == "c"


def test_performers_are_followed_independently() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 2000}, "c", who="joe")])
    )
    assert errors_of(findings) == []
    a = show.cue_map()["a"]
    assert a.action["from"] == "sr"
    assert a.duration_ms == C_TO_SR


def test_after_chains_are_followed_by_start_time() -> None:
    show, findings = compiled(
        production(
            [
                light("z", 0),
                move("b", {"after": "z", "offset": 1000}, "c"),
                move("a", {"after": "b", "offset": 7000}, "sr"),
            ]
        )
    )
    assert errors_of(findings) == []
    assert show.cue_map()["b"].action["from"] == "sl"
    assert show.cue_map()["a"].action["from"] == "c"
    assert show.cue_map()["a"].duration_ms == C_TO_SR


def test_compile_json_carries_the_resolved_from(tmp_path: Path) -> None:
    path = tmp_path / "marks.yaml"
    path.write_text(
        "version: 1\nproduction: marks\ntime_unit: ms\n"
        "performers:\n  mira: {initial_mark: sl}\n"
        "locations:\n  sl: {x: 0, y: 0}\n  c: {x: 8, y: 0}\n  sr: {x: 20, y: 0}\n"
        "cues:\n"
        "  - id: b\n    department: stage\n    trigger: {at: 1000}\n"
        "    action: {move: mira, to: c, maximum_speed: 1.4}\n"
        "  - id: a\n    department: stage\n    trigger: {at: 8000}\n"
        "    action: {move: mira, to: sr, maximum_speed: 1.4}\n",
        encoding="utf-8",
    )
    result = runner.invoke(app, ["compile", str(path), "--format", "json"])
    assert result.exit_code == 0
    assert '"from":"c"' in result.stdout
    assert '"from":"sl"' in result.stdout


def test_travel_from_the_real_position_moves_the_reservations() -> None:
    proj = {"proj": {"kind": "video_output", "capacity": 1}}
    first = move("b", {"at": 1000}, "c")
    second = move("a", {"at": 8000}, "sr")
    second["uses"] = ["proj"]
    clear = {"id": "x", "department": "video", "trigger": {"at": 17000}, "duration": 100, "uses": ["proj"]}
    show, findings = compiled(production([first, second, clear], resources=proj))
    assert errors_of(findings) == []
    assert show.cue_map()["a"].end_ms() == 8000 + C_TO_SR
    close = dict(clear, id="y", trigger={"at": 16000})
    _, crowded = compiled(production([first, second, close], resources=proj))
    assert "CF4001" in codes_of(crowded)


def test_two_performers_may_move_at_the_same_instant() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 1000}, "c", who="joe")])
    )
    assert errors_of(findings) == []
    assert show.cue_map()["b"].action["from"] == "sl"
    assert show.cue_map()["a"].action["from"] == "sr"
    assert show.cue_map()["a"].duration_ms == C_TO_SR


def test_positions_continue_past_a_flagged_move() -> None:
    show, findings = compiled(
        production(
            [
                move("b", {"at": 1000}, "c"),
                move("a", {"at": 3000}, "sr"),
                move("d", {"at": 3000 + C_TO_SR}, "c"),
            ]
        )
    )
    assert subjects_of(findings, "CF5004") == ["a"]
    assert show.cue_map()["d"].action["from"] == "sr"
    assert show.cue_map()["d"].duration_ms == C_TO_SR


def test_unknown_initial_mark_stays_an_error_beside_a_move() -> None:
    ghost = {"mira": {"initial_mark": "sl"}, "ghost": {"initial_mark": "nowhere"}}
    _, findings = compile_of(
        production([move("b", {"at": 1000}, "c", who="ghost")], performers=ghost)
    )
    assert "CF5002" in errors_of(findings)
    assert "CF5004" not in codes_of(findings)


def test_compile_text_report_carries_the_finding(tmp_path: Path) -> None:
    path = tmp_path / "disagree.yaml"
    path.write_text(
        "version: 1\nproduction: marks\ntime_unit: ms\n"
        "performers:\n  mira: {initial_mark: sl}\n"
        "locations:\n  sl: {x: 0, y: 0}\n  c: {x: 8, y: 0}\n  sr: {x: 20, y: 0}\n"
        "cues:\n"
        "  - id: b\n    department: stage\n    trigger: {at: 1000}\n"
        "    action: {move: mira, to: c, maximum_speed: 1.4}\n"
        "  - id: a\n    department: stage\n    trigger: {at: 8000}\n"
        "    action: {move: mira, from: sl, to: sr, maximum_speed: 1.4}\n",
        encoding="utf-8",
    )
    result = runner.invoke(app, ["compile", str(path), "--format", "json"])
    assert result.exit_code == 1
    report = json.loads(result.stdout)
    assert report["ok"] is False
    flagged = [(item["code"], item["subject_id"]) for item in report["findings"]]
    assert flagged == [("CF5004", "a")]
    assert '"from":"c"' in result.stdout


def test_moves_are_ordered_by_start_not_by_dependency() -> None:
    # b is authored first and a hangs off it, yet a's negative offset starts it
    # four seconds earlier, so b is the one that runs into a.
    show, findings = compiled(
        production(
            [
                move("b", {"at": 5000}, "c"),
                move("a", {"after": "b", "offset": -4000}, "sr"),
            ]
        )
    )
    assert subjects_of(findings, "CF5004") == ["b"]
    assert show.cue_map()["a"].action["from"] == "sl"
    assert show.cue_map()["a"].duration_ms == SL_TO_SR
    assert show.cue_map()["b"].action["from"] == "sr"
    assert show.cue_map()["b"].duration_ms == C_TO_SR


def test_a_zero_travel_move_never_runs() -> None:
    show, findings = compiled(
        production(
            [
                move("b", {"at": 1000}, "c"),
                move("d", {"at": 1000 + SL_TO_C}, "c"),
                move("e", {"at": 1000 + SL_TO_C}, "sr"),
            ]
        )
    )
    assert errors_of(findings) == []
    assert show.cue_map()["d"].action["from"] == "c"
    assert show.cue_map()["d"].duration_ms == 0
    assert show.cue_map()["e"].action["from"] == "c"
    assert show.cue_map()["e"].duration_ms == C_TO_SR


def test_a_stated_from_is_taken_as_authored_while_the_position_is_unknown() -> None:
    show, findings = compiled(
        production([move("m", {"manual": True}, "c", from_mark="sr"), light("x", 0)])
    )
    assert errors_of(findings) == []
    assert show.cue_map()["m"].action["from"] == "sr"
    assert show.cue_map()["m"].duration_ms == C_TO_SR
    _, missing = compile_of(production([move("m", {"manual": True}, "c"), light("x", 0)]))
    assert subjects_of(missing, "CF3005") == ["m"]
    assert "CF5004" not in codes_of(missing)


def test_a_running_move_is_flagged_even_when_from_names_its_destination() -> None:
    show, findings = compiled(
        production([move("b", {"at": 1000}, "c"), move("a", {"at": 3000}, "sr", from_mark="c")])
    )
    flagged = [item for item in findings if item.code == "CF5004"]
    assert [item.subject_id for item in flagged] == ["a"]
    assert show.cue_map()["a"].action["from"] == "c"
    assert show.cue_map()["a"].duration_ms == C_TO_SR
