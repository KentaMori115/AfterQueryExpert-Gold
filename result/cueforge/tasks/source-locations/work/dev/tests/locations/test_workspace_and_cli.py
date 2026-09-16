"""Workspaces, the compile command, assertions at compile time, and what stays put."""

import json
from pathlib import Path

from typer.testing import CliRunner

from cueforge import compile_production, load_production, rehearse
from cueforge.cli.main import app

runner = CliRunner()


def at(text: str, line: int, token: str, nth: int = 1) -> tuple[int, int]:
    row = text.split("\n")[line - 1]
    index = -1
    for _ in range(nth):
        index = row.index(token, index + 1)
    return line, index + 1


def where(finding) -> tuple[int, int]:
    return finding.source.line, finding.source.column


def one(findings, code: str, **match):
    picked = [
        item
        for item in findings
        if item.code == code and all(getattr(item, key) == value for key, value in match.items())
    ]
    assert picked, [(item.code, item.message) for item in findings]
    return picked[0]


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


MANIFEST = """version: 1
production: split
time_unit: ms
sources:
  - cues_a.yaml
  - parts/cues_b.yaml
cues:
  - id: root_cue
    department: lx
    trigger: {at: 0}
    duration: 1e3
"""

CUES_A = """resources:
  lamp: {kind: light}
cues:
  - id: a
    department: lx
    trigger: {at: 0}
"""

CUES_B = """cues:
  - id: b
    department: lx
    trigger: {after: nope}
"""


def workspace(root: Path) -> Path:
    write(root / "cueforge.yaml", MANIFEST)
    write(root / "cues_a.yaml", CUES_A)
    write(root / "parts" / "cues_b.yaml", CUES_B)
    return root


def test_workspace_member_file_locations(tmp_path: Path) -> None:
    loaded = load_production(workspace(tmp_path))
    assert loaded.value is not None, loaded.findings
    findings = compile_production(loaded.value).findings
    finding = one(findings, "CF1002")
    assert finding.source.path == "parts/cues_b.yaml"
    assert where(finding) == at(CUES_B, 4, "nope")


def test_manifest_cues_come_first_and_keep_their_own_file(tmp_path: Path) -> None:
    loaded = load_production(workspace(tmp_path))
    assert [cue.id for cue in loaded.value.cues] == ["root_cue", "a", "b"]
    finding = one(compile_production(loaded.value).findings, "CF2002")
    assert finding.source.path == "cueforge.yaml"
    assert where(finding) == at(MANIFEST, 11, "1e3")


DUPLICATE_B = """resources:
  lamp: {kind: light}
production: other
cues: []
"""


def test_cross_file_duplicate_location(tmp_path: Path) -> None:
    workspace(tmp_path)
    write(tmp_path / "parts" / "cues_b.yaml", DUPLICATE_B)
    loaded = load_production(tmp_path)
    assert loaded.value is None
    duplicate = one(loaded.findings, "CF1001", subject_id="lamp")
    assert duplicate.source.path == "parts/cues_b.yaml"
    assert where(duplicate) == at(DUPLICATE_B, 2, "lamp")
    conflict = one(loaded.findings, "CF1001", subject_id="production")
    assert conflict.source.path == "parts/cues_b.yaml"
    assert where(conflict) == at(DUPLICATE_B, 3, "production")


BAD_SOURCES = """version: 1
production: bad
time_unit: ms
sources:
  - ../outside.yaml
  - missing.yaml
cues: []
"""


def test_bad_sources_entry_location(tmp_path: Path) -> None:
    write(tmp_path / "cueforge.yaml", BAD_SOURCES)
    loaded = load_production(tmp_path)
    assert loaded.value is None
    escape = one(loaded.findings, "CF1003")
    assert escape.source.path == "cueforge.yaml"
    assert where(escape) == at(BAD_SOURCES, 5, "../outside.yaml")
    missing = one(loaded.findings, "CF1005")
    assert where(missing) == at(BAD_SOURCES, 6, "missing.yaml")


JSON_WORKSPACE = """{"version": 1, "production": "jws", "time_unit": "ms",
 "sources": ["cues.json"]}
"""

JSON_CUES = """{"cues": [
  {"id": "a", "department": "lx", "trigger": {"at": 0}, "uses": ["ghost"]}
]}
"""


def test_json_workspace_member_locations(tmp_path: Path) -> None:
    write(tmp_path / "cueforge.json", JSON_WORKSPACE)
    write(tmp_path / "cues.json", JSON_CUES)
    loaded = load_production(tmp_path)
    assert loaded.value is not None, loaded.findings
    finding = one(compile_production(loaded.value).findings, "CF4004")
    assert finding.source.path == "cues.json"
    assert where(finding) == at(JSON_CUES, 2, '"ghost"')


ASSERTED = """version: 1
production: asserted
time_unit: ms
resources:
  lamp:
    kind: light
    states: [off, on]
    initial_state: off
cues:
  - id: a
    department: lx
    trigger: {at: 0}
    duration: 100
assertions:
  - expression: "ghost.started before a.completed"
  - expression: "a.visibl before a.completed"
  - expression: "nores.state == on at a.started"
  - expression: "lamp.state == flying at a.started"
  - expression: "a.started before a.completed"
"""


def test_unknown_assertion_subjects_fail_the_compile_at_the_expression(tmp_path: Path) -> None:
    write(tmp_path / "asserted.yaml", ASSERTED)
    loaded = load_production(tmp_path / "asserted.yaml")
    assert loaded.is_ok
    compiled = compile_production(loaded.value)
    assert not compiled.is_ok
    assert compiled.value is None
    subjects = [item for item in compiled.findings if item.code == "CF6003"]
    assert sorted(where(item) for item in subjects) == [
        at(ASSERTED, 15, '"'),
        at(ASSERTED, 16, '"'),
        at(ASSERTED, 17, '"'),
        at(ASSERTED, 18, '"'),
    ]


SYNTAX = """version: 1
production: syntax
time_unit: ms
cues:
  - id: a
    department: lx
    trigger: {at: 0}
assertions:
  - expression: a.started before a.completed
  - expression: this is not an assertion
"""


def test_assertion_syntax_error_fails_the_compile_at_the_expression(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "syntax.yaml", SYNTAX))
    compiled = compile_production(loaded.value)
    assert not compiled.is_ok
    assert where(one(compiled.findings, "CF6002")) == at(SYNTAX, 10, "this")


def test_only_the_bad_assertion_stops_the_compile(tmp_path: Path) -> None:
    text = ASSERTED.replace("ghost.started", "a.started").replace("a.visibl", "a.started")
    text = text.replace("nores.state == on", "lamp.state == off").replace("flying", "off")
    loaded = load_production(write(tmp_path / "fine.yaml", text))
    compiled = compile_production(loaded.value)
    assert compiled.is_ok, compiled.findings
    result = rehearse(compiled.value)
    assert not any(item.code.startswith("CF6") for item in result.findings)
    spoiled = text.replace("lamp.state == off at a.started", "lamp.state == dim at a.started", 1)
    broken = compile_production(load_production(write(tmp_path / "spoiled.yaml", spoiled)).value)
    assert not broken.is_ok
    assert [item.code for item in broken.findings] == ["CF6003"]
    assert where(broken.findings[0]) == at(spoiled, 17, '"')


FAILING = """version: 1
production: failing
time_unit: ms
cues:
  - id: a
    department: lx
    trigger: {at: 0}
    duration: 100
  - id: b
    department: lx
    trigger: {after: a, offset: 50}
    duration: 100
assertions:
  - expression: "a.completed before b.started"
"""


def test_rehearsal_output_and_digests_ignore_where_text_sits(tmp_path: Path) -> None:
    plain = write(tmp_path / "plain.yaml", FAILING)
    shifted = write(tmp_path / "shifted.yaml", "# a comment\n# another\n" + FAILING)
    shows = [compile_production(load_production(path).value).value for path in (plain, shifted)]
    assert shows[0].digest == shows[1].digest
    results = [rehearse(show) for show in shows]
    assert any(item.code == "CF6001" for item in results[0].findings)
    assert results[0].digest == results[1].digest
    assert results[0].semantic_dict() == results[1].semantic_dict()
    outputs = [
        runner.invoke(app, ["rehearse", str(path), "--format", "json"]).stdout for path in (plain, shifted)
    ]
    assert outputs[0] == outputs[1]
    broken = FAILING.replace("after: a", "after: zz")
    lines = [
        one(compile_production(load_production(write(tmp_path / name, text)).value).findings, "CF1002").source.line
        for name, text in (("b1.yaml", broken), ("b2.yaml", "# a comment\n# another\n" + broken))
    ]
    assert lines == [11, 13]


def test_compile_json_carries_source_objects(tmp_path: Path) -> None:
    path = write(tmp_path / "broken.yaml", FAILING.replace("after: a", "after: zz"))
    result = runner.invoke(app, ["compile", str(path), "--format", "json"])
    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    finding = next(item for item in payload["findings"] if item["code"] == "CF1002")
    assert finding["source"] == {"path": path.as_posix(), "line": 11, "column": 22}


NO_CUES = """version: 1
production: nocues
time_unit: ms
"""


def test_compile_json_leaves_source_out_without_a_node(tmp_path: Path) -> None:
    path = write(tmp_path / "nocues.yaml", NO_CUES)
    result = runner.invoke(app, ["compile", str(path), "--format", "json"])
    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    finding = next(item for item in payload["findings"] if item["code"] == "CF3006")
    assert "source" not in finding
    empty = write(tmp_path / "empty.yaml", NO_CUES + "cues: []\n")
    result = runner.invoke(app, ["compile", str(empty), "--format", "json"])
    assert result.exit_code == 1
    finding = next(item for item in json.loads(result.stdout)["findings"] if item["code"] == "CF3006")
    assert finding["source"] == {"column": 7, "line": 4, "path": str(empty)}


def test_load_failures_print_source_in_compile_json(tmp_path: Path) -> None:
    text = "version: 1\nproduction: x\ntime_unit: ms\ncues:\n  - id: a\n    trigger: {at: 0}\n"
    path = write(tmp_path / "missing.yaml", text)
    result = runner.invoke(app, ["compile", str(path), "--format", "json"])
    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    finding = next(item for item in payload["findings"] if item["code"] == "CF1010")
    assert finding["source"]["line"] == 5
    assert finding["source"]["column"] == 5


