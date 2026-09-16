"""Where findings point in JSON productions."""

import json
from pathlib import Path

from cueforge import compile_production, load_production


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


def compiled_findings(path: Path):
    loaded = load_production(path)
    assert loaded.value is not None, loaded.findings
    return compile_production(loaded.value).findings


def write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


SHOW = """{
  "version": 1,
  "production": "show",
  "time_unit": "ms",
  "resources": {"lamp": {"kind": "light", "capacity": -1}},
  "cues": [
    {"id": "a", "department": "lx",
     "trigger": {"at": 0, "offset": 1.5},
     "duration": 1e3},
    {"id": "b", "department": "lx", "trigger": {"after": "zed"}, "uses": ["lamp", "moon"]}
  ]
}
"""


def test_fractional_offset_points_at_the_token(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "show.json", SHOW))
    assert where(one(findings, "CF2007")) == at(SHOW, 8, "1.5")


def test_scientific_duration_points_at_the_token(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "show.json", SHOW))
    assert where(one(findings, "CF2002")) == at(SHOW, 9, "1e3")


def test_bad_capacity_points_at_the_number(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "show.json", SHOW))
    assert where(one(findings, "CF2001")) == at(SHOW, 5, "-1")


def test_missing_after_points_at_the_string_quote(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "show.json", SHOW))
    assert where(one(findings, "CF1002")) == at(SHOW, 10, '"zed"')


def test_unknown_used_resource_points_at_that_item(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "show.json", SHOW))
    assert where(one(findings, "CF4004")) == at(SHOW, 10, '"moon"')


def test_json_path_is_the_path_given(tmp_path: Path) -> None:
    path = write(tmp_path / "show.json", SHOW)
    assert one(compiled_findings(path), "CF2002").source.path == path.as_posix()


ESCAPED = '{"production": "caf\\u00e9 \\"q\\" \\\\", "version": 2, "time_unit": "ms", "cues": []}\n'


def test_escapes_before_a_token_count_as_written(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "escaped.json", ESCAPED))
    assert loaded.value is None
    assert where(one(loaded.findings, "CF1004")) == at(ESCAPED, 1, "2")


REPEATED = """{"version": 1, "production": "twice", "time_unit": "ms",
 "cues": [{"id": "a", "department": "lx", "trigger": {"at": 0},
           "duration": 5, "duration": 1e3}]}
"""


def test_repeated_key_keeps_the_last_value_and_its_position(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "twice.json", REPEATED))
    assert where(one(findings, "CF2002")) == at(REPEATED, 3, "1e3")


SCHEMA = """{
  "version": 1,
  "production": "schema",
  "time_unit": "ms",
  "cues": [
    {"id": "a", "department": "lx", "trigger": {"at": 0},
     "colour": "red"},
    {"id": "b",
     "trigger": {"at": 0}},
    {"id": "c", "department": "lx", "trigger": {"at": 0, "manual": true}}
  ]
}
"""


def test_unknown_field_points_at_its_key(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.json", SCHEMA))
    assert loaded.value is None
    assert where(one(loaded.findings, "CF1009")) == at(SCHEMA, 7, '"colour"')


def test_missing_field_points_at_the_object_brace(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.json", SCHEMA))
    assert where(one(loaded.findings, "CF1010")) == at(SCHEMA, 8, "{")


def test_trigger_with_two_kinds_points_at_its_brace(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.json", SCHEMA))
    assert where(one(loaded.findings, "CF1005")) == at(SCHEMA, 10, "{", nth=2)


SPEED = """{
  "version": 1, "production": "speed", "time_unit": "ms",
  "performers": {"mira": {"initial_mark": "sl"}},
  "locations": {"sl": {"x": 0, "y": 0}, "c": {"x": 8, "y": "0.5"}},
  "cues": [
    {"id": "cross", "department": "stage", "trigger": {"at": 0},
     "action": {"move": "mira", "from": "sl", "to": "c", "maximum_speed": "1e1"}}
  ]
}
"""


def test_quoted_numbers_point_at_their_quote(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "speed.json", SPEED))
    assert where(one(findings, "CF2007")) == at(SPEED, 4, '"0.5"')
    assert where(one(findings, "CF2002")) == at(SPEED, 7, '"1e1"')


BROKEN = """{"version": 1,
 "cues": tru}
"""


def test_parse_error_points_where_the_parser_stopped(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "broken.json", BROKEN))
    assert where(one(loaded.findings, "CF1005")) == at(BROKEN, 2, "tru")


TEXTUAL = """{"version": 1, "production": "textual", "time_unit": "ms",
 "events": {"go": 2500},
 "cues": [{"id": "a", "department": "lx", "trigger": {"on": "go", "offset": -800}, "duration": 1500}]}
"""


def test_number_tokens_still_arrive_as_text(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "textual.json", TEXTUAL))
    assert loaded.value is not None
    assert loaded.value.events["go"] == "2500"
    assert loaded.value.cues[0].trigger.offset == "-800"
    compiled = compile_production(loaded.value)
    assert compiled.is_ok
    assert compiled.value.cue_map()["a"].start_ms == 1700


def test_json_and_yaml_findings_agree_on_the_node(tmp_path: Path) -> None:
    yaml_text = "version: 1\nproduction: pair\ntime_unit: ms\ncues:\n  - id: a\n    department: lx\n    trigger: {at: 0}\n    duration: 1e3\n"
    json_text = json.dumps(
        {
            "version": 1,
            "production": "pair",
            "time_unit": "ms",
            "cues": [{"id": "a", "department": "lx", "trigger": {"at": 0}, "duration": 1000}],
        },
        indent=2,
    ).replace("1000", "1e3")
    yaml_finding = one(compiled_findings(write(tmp_path / "pair.yaml", yaml_text)), "CF2002")
    json_finding = one(compiled_findings(write(tmp_path / "pair.json", json_text)), "CF2002")
    assert where(yaml_finding) == at(yaml_text, 8, "1e3")
    assert where(json_finding) == at(json_text, 12, "1e3")
