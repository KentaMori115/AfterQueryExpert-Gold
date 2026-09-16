"""Where findings point in YAML productions."""

from pathlib import Path

from cueforge import compile_production, load_production, rehearse
from cueforge.simulation import DelayCue


def at(text: str, line: int, token: str, nth: int = 1) -> tuple[int, int]:
    """(line, column) of the nth occurrence of ``token`` on ``line`` of ``text``."""
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


VALUES = """version: 1
production: values
time_unit: ms
events:
  line_9: 1e3
locations:
  mark: {x: 1.5, y: 0}
resources:
  lamp:
    kind: light
    capacity: 0
cues:
  - id: a
    department: lx
    trigger: {at: 0, offset: 2.5}
    duration: -5
"""


def test_scientific_event_time_points_at_the_event_value(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "values.yaml", VALUES))
    assert where(one(findings, "CF2002")) == at(VALUES, 5, "1e3")


def test_fractional_coordinate_points_at_the_coordinate(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "values.yaml", VALUES))
    assert where(one(findings, "CF2007", subject_id="locations.mark.x")) == at(VALUES, 7, "1.5")


def test_bad_capacity_points_at_the_capacity(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "values.yaml", VALUES))
    assert where(one(findings, "CF2001")) == at(VALUES, 11, "0")


def test_fractional_offset_points_at_the_offset(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "values.yaml", VALUES))
    assert where(one(findings, "CF2007", subject_id="a.offset")) == at(VALUES, 15, "2.5")


def test_negative_duration_points_at_the_duration(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "values.yaml", VALUES))
    assert where(one(findings, "CF2003")) == at(VALUES, 16, "-5")


def test_single_file_path_is_the_path_given(tmp_path: Path) -> None:
    path = write(tmp_path / "values.yaml", VALUES)
    findings = compiled_findings(path)
    assert one(findings, "CF2003").source.path == path.as_posix()


def test_relative_path_drops_the_leading_dot_slash(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "values.yaml", VALUES)
    monkeypatch.chdir(tmp_path)
    findings = compiled_findings(Path("./values.yaml"))
    assert one(findings, "CF2003").source.path == "values.yaml"


ABSOLUTE = """version: 1
production: absolute
time_unit: ms
cues:
  - id: a
    department: lx
    trigger:
      at: "12.5"
"""


def test_quoted_scalar_points_at_its_quote(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "absolute.yaml", ABSOLUTE))
    assert where(one(findings, "CF2007")) == at(ABSOLUTE, 8, '"12.5"')


SPEED = """version: 1
production: speed
time_unit: ms
performers:
  mira: {initial_mark: sl}
locations:
  sl: {x: 0, y: 0}
  c: {x: 8, y: 0}
cues:
  - id: cross
    department: stage
    trigger: {at: 0}
    action:
      move: mira
      from: sl
      to: c
      maximum_speed: 1.4001
"""

MOVEMENT = """version: 1
production: movement
time_unit: ms
performers:
  mira: {initial_mark: sl}
locations:
  sl: {x: 0, y: 0}
  c: {x: 8, y: 0}
cues:
  - id: slow
    department: stage
    trigger: {at: 0}
    duration: 10
    action: {move: mira, from: sl, to: c, maximum_speed: 1.4}
  - id: lost
    department: stage
    trigger: {at: 0}
    action:
      move: mira
      maximum_speed: 1
"""


def test_bad_speed_points_at_maximum_speed(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "speed.yaml", SPEED))
    assert where(one(findings, "CF2006")) == at(SPEED, 17, "1.4001")


def test_short_duration_points_at_the_duration(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "movement.yaml", MOVEMENT))
    assert where(one(findings, "CF5001")) == at(MOVEMENT, 13, "10")


def test_incomplete_move_points_at_the_action_mapping(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "movement.yaml", MOVEMENT))
    assert where(one(findings, "CF5004")) == at(MOVEMENT, 19, "move")


VERSION = """version: 2
production: future
time_unit: ms
cues: []
"""


def test_unsupported_version_points_at_the_version(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "version.yaml", VERSION))
    assert loaded.value is None
    assert where(one(loaded.findings, "CF1004")) == at(VERSION, 1, "2")


REFS = """version: 1
production: refs
time_unit: ms
resources:
  lamp: {kind: light}
cues:
  - id: a
    department: lx
    trigger: {after: ghost}
  - id: b
    department: lx
    trigger: {on: line_9}
    uses: [lamp, ghost_res]
    requires:
      - resource: nothing
  - id: a
    department: lx
    trigger: {at: 0}
    action: {resource: phantom}
"""


def test_missing_after_points_at_the_after_value(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "refs.yaml", REFS))
    assert where(one(findings, "CF1002", subject_id="a")) == at(REFS, 9, "ghost")


def test_missing_event_points_at_the_on_value(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "refs.yaml", REFS))
    assert where(one(findings, "CF1002", subject_id="b")) == at(REFS, 12, "line_9")


def test_unknown_used_resource_points_at_that_uses_item(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "refs.yaml", REFS))
    picked = [item for item in findings if item.code == "CF4004" and item.subject_id == "b"]
    assert sorted(where(item) for item in picked) == [at(REFS, 13, "ghost_res"), at(REFS, 15, "nothing")]


def test_unknown_action_resource_points_at_that_value(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "refs.yaml", REFS))
    assert where(one(findings, "CF4004", subject_id="a")) == at(REFS, 19, "phantom")


def test_duplicate_cue_id_points_at_the_second_id(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "refs.yaml", REFS))
    assert where(one(findings, "CF1001")) == at(REFS, 16, "a")


MOVES = """version: 1
production: moves
time_unit: ms
performers:
  mira: {initial_mark: sl}
locations:
  sl: {x: 0, y: 0}
cues:
  - id: walk
    department: stage
    trigger: {at: 0}
    action:
      move: nobody
      from: sl
      to: nowhere
      maximum_speed: 1
  - id: walk2
    department: stage
    trigger: {at: 0}
    action: {move: mira, from: void, to: sl, maximum_speed: 1}
"""


def test_unknown_performer_points_at_move(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "moves.yaml", MOVES))
    assert where(one(findings, "CF5003")) == at(MOVES, 13, "nobody")


def test_unknown_locations_point_at_to_and_from(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "moves.yaml", MOVES))
    assert where(one(findings, "CF5002", subject_id="walk")) == at(MOVES, 15, "nowhere")
    assert where(one(findings, "CF5002", subject_id="walk2")) == at(MOVES, 20, "void")


SCHEMA = """version: 1
production: schema
time_unit: ms
cues:
  - id: a
    department: lx
    trigger: {at: 0}
    colour: red
  - id: b
    trigger: {at: 0}
  - id: c
    department: lx
    trigger: {at: 0, after: b}
"""


def test_unknown_field_points_at_its_key(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.yaml", SCHEMA))
    assert loaded.value is None
    assert where(one(loaded.findings, "CF1009")) == at(SCHEMA, 8, "colour")


def test_missing_field_points_at_the_mapping_lacking_it(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.yaml", SCHEMA))
    assert where(one(loaded.findings, "CF1010")) == at(SCHEMA, 9, "id")


def test_trigger_with_two_kinds_points_at_the_trigger(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "schema.yaml", SCHEMA))
    assert where(one(loaded.findings, "CF1005")) == at(SCHEMA, 13, "{")


IDENTS = """version: 1
production: idents
time_unit: ms
resources:
  bad key: {kind: light}
cues:
  - id: 1bad
    department: lx
    trigger: {at: 0}
"""


def test_bad_identifiers_point_at_key_and_id(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "idents.yaml", IDENTS))
    assert where(one(findings, "CF1007", subject_kind="resource")) == at(IDENTS, 5, "bad key")
    assert where(one(findings, "CF1007", subject_kind="cue")) == at(IDENTS, 7, "1bad")


CYCLE = """version: 1
production: cyc
time_unit: ms
cues:
  - id: b
    department: lx
    trigger: {after: a}
  - id: a
    department: lx
    trigger:
      after: b
"""


def test_cycle_points_at_the_smallest_ids_after(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "cycle.yaml", CYCLE))
    assert where(one(findings, "CF3002")) == at(CYCLE, 11, "b")


SELF = """version: 1
production: self
time_unit: ms
cues:
  - id: loop
    department: lx
    trigger: {after: loop}
"""


def test_self_dependency_points_at_its_after(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "self.yaml", SELF))
    assert where(one(findings, "CF3003")) == at(SELF, 7, "loop")


FIGHT = """version: 1
production: fight
time_unit: ms
resources:
  proj:
    kind: video
cues:
  - id: v1
    department: video
    trigger: {at: 0}
    duration: 5000
    uses: [proj]
  - id: v2
    department: video
    trigger: {at: 2000}
    duration: 5000
    uses: [proj]
"""


def test_reservation_conflict_points_at_the_resource_key(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "fight.yaml", FIGHT))
    assert where(one(findings, "CF4001")) == at(FIGHT, 5, "proj")


EMPTY = """version: 1
production: empty
time_unit: ms
cues: []
"""


def test_no_cues_points_at_cues(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "empty.yaml", EMPTY))
    assert where(one(findings, "CF3006")) == at(EMPTY, 4, "[]")


STATE = """version: 1
production: state
time_unit: ms
resources:
  revolve:
    kind: automation
    states: [home, away]
    initial_state: orbit
cues:
  - id: a
    department: lx
    trigger: {at: 0}
"""


def test_undeclared_initial_state_points_at_initial_state(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "state.yaml", STATE))
    assert where(one(findings, "CF4005")) == at(STATE, 8, "orbit")


BROKEN = "a: [1, 2\nb: 3\n"


def test_parse_error_points_where_the_parser_stopped(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "broken.yaml", BROKEN))
    finding = one(loaded.findings, "CF1005")
    assert finding.source.path == (tmp_path / "broken.yaml").as_posix()
    assert where(finding) == (2, 2)


ORDER = """version: 1
production: order
time_unit: ms
cues:
  - id: a
    department: lx
    trigger: {at: 0, offset: 2.5}
  - id: b
    department: lx
    trigger: {after: ghost}
"""


def test_findings_come_out_in_text_order(tmp_path: Path) -> None:
    findings = compiled_findings(write(tmp_path / "order.yaml", ORDER))
    assert [item.code for item in findings] == ["CF2007", "CF1002"]
    assert [where(item) for item in findings] == [at(ORDER, 7, "2.5"), at(ORDER, 10, "ghost")]


def test_findings_about_nothing_authored_keep_no_source(tmp_path: Path) -> None:
    loaded = load_production(write(tmp_path / "fight.yaml", FIGHT))
    compiled = compile_production(loaded.value)
    assert compiled.value is not None
    assert one(compiled.findings, "CF4001").source is not None
    result = rehearse(compiled.value, [DelayCue("missing", 10)])
    assert one(result.findings, "CF7003").source is None
