"""The head schedule as it reaches a reader: the tables, the rules, the command.

Nothing here reaches into the working. It asks the locking table what a route
releases, asks the rule engine what it thinks of a wide reset zone, and asks the
command line to print the schedule, which is how anybody outside the package
meets any of this.
"""

from __future__ import annotations

import json
import pathlib

from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.interchange.json_io import dumps
from signalbox.interchange.schema import problems
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.locking_table import LOCKING_COLUMNS, build_locking_report
from signalbox.topology.scheme import scheme_from_text
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

runner = CliRunner()

PAIR = """
scheme demo {
    area "Demo"
    prefix D
}
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 500 speed 60 direction down
edge E2 from J1 to B length 500 speed 60 direction down
section TA counted over E1
section TB counted over E2
signal D1 on E1 at 0 facing forward direction down aspects 3
"""

LONE = PAIR.replace("section TA counted over E1", "section TA over E1")

PLAIN = PAIR.replace("counted ", "")

SPLIT = """
scheme demo {
    area "Demo"
    prefix D
}
node A boundary
node P1 points
node B boundary
node C boundary
edge E1 from A to P1.toe length 500 speed 60 direction bidirectional
edge E2 from P1.normal to B length 500 speed 60 direction bidirectional
edge E3 from P1.reverse to C length 500 speed 40 direction bidirectional
section TA over E1
section TB counted over E2
section TC counted over E3
"""

WIDE = """
scheme demo {
    area "Demo"
    prefix D
}
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 400 speed 60 direction bidirectional
edge E2 from J1 to J2 length 400 speed 60 direction bidirectional
edge E3 from J2 to B length 400 speed 60 direction bidirectional
section TA counted over E1
section TB counted over E2
section TC counted over E3
"""


def report_for(text):
    return build_locking_report(build_interlocking(scheme_from_text(text)))


def exported(text):
    scheme = scheme_from_text(text)
    return json.loads(dumps(scheme, build_interlocking(scheme)))


def findings(text):
    return run(Context.build(scheme_from_text(text)), only=["detection-zone"])


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return str(path)


# --- the locking table -----------------------------------------------------


def test_the_locking_table_has_a_zones_column():
    assert "zones" in LOCKING_COLUMNS


def test_a_route_says_which_zones_its_track_sits_in():
    assert report_for(PAIR).row("D1(M)").cell("zones") == "TA"


def test_a_route_over_track_circuits_sits_in_none():
    assert report_for(PLAIN).row("D1(M)").cell("zones") == ""


def test_a_route_all_inside_one_zone_prints_complete():
    assert report_for(PAIR).row("D1(M)").release == "complete"


def test_a_route_over_mixed_detection_still_prints_sectional():
    assert report_for(LONE).row("D1(M)").release == "sectional"
    assert report_for(PAIR).row("D1(M)").release == "complete"


def test_every_column_of_the_locking_table_still_renders():
    row = report_for(PAIR).row("D1(M)")
    for column in LOCKING_COLUMNS:
        assert isinstance(row.cell(column), str)
    assert row.cell("zones") == "TA"


def test_the_table_still_has_a_row_for_every_route():
    interlocking = build_interlocking(scheme_from_text(PAIR))
    assert len(report_for(PAIR).rows) == len(interlocking)
    assert all(row.cell("zones") == "TA" for row in report_for(PAIR).rows)


# --- the interchange file --------------------------------------------------


def test_export_validates_when_counters_are_present():
    assert list(problems(exported(PAIR))) == []
    assert list(problems(exported(SPLIT))) == []
    assert all("zone" in item for item in exported(PAIR)["sections"])


def test_export_validates_for_a_wholly_circuited_layout():
    assert list(problems(exported(PLAIN))) == []
    assert not any("zone" in item for item in exported(PLAIN)["sections"])
    assert any("zone" in item for item in exported(PAIR)["sections"])


def test_a_section_record_keeps_everything_it_always_had():
    record = next(item for item in exported(PAIR)["sections"] if item["name"] == "TA")
    assert record["kind"] == "axle_counter"
    assert record["edges"] == ["E1"]
    assert record["length"] == 500.0
    assert record["heads"] == ["A", "J1"]
    assert exported(PAIR)["schema"] == 2


def test_the_zone_is_shared_by_both_sections_of_a_pair():
    zones = {item["name"]: item.get("zone") for item in exported(PAIR)["sections"]}
    assert zones == {"TA": "TA", "TB": "TA"}


def test_the_zone_is_absent_from_a_track_circuit_record():
    zones = {item["name"]: item.get("zone") for item in exported(LONE)["sections"]}
    assert zones == {"TA": None, "TB": "TB"}


# --- the rule --------------------------------------------------------------


def test_a_zone_covering_several_sections_is_reported():
    report = findings(PAIR)
    assert len(report) == 1
    assert next(iter(report)).subject == "TA"


def test_the_finding_is_not_fatal():
    finding = next(iter(findings(PAIR)))
    assert finding.severity is not Severity.ERROR


def test_a_zone_of_one_is_not_reported():
    assert findings(LONE).clean
    assert findings(SPLIT).clean
    assert findings(PLAIN).clean


def test_one_finding_covers_the_whole_zone_however_wide_it_is():
    report = findings(WIDE)
    assert len(report) == 1
    assert next(iter(report)).subject == "TA"


def test_the_rule_runs_as_part_of_a_whole_check():
    subjects = {
        finding.subject for finding in run(Context.build(scheme_from_text(PAIR)))
        if finding.rule == "detection-zone"
    }
    assert subjects == {"TA"}


# --- the command line ------------------------------------------------------


def test_the_heads_command_prints_a_schedule(tmp_path):
    result = runner.invoke(app, ["heads", write(tmp_path, "demo.sbx", PAIR)])
    assert result.exit_code == 0
    assert "J1" in result.stdout
    assert "TA" in result.stdout
    assert "TB" in result.stdout


def test_schedule_shows_normal_and_reverse_at_a_turnout(tmp_path):
    result = runner.invoke(app, ["heads", write(tmp_path, "split.sbx", SPLIT)])
    assert result.exit_code == 0
    assert "P1.normal" in result.stdout
    assert "P1.reverse" in result.stdout


def test_the_heads_command_can_print_the_zones_instead(tmp_path):
    result = runner.invoke(app, ["heads", write(tmp_path, "demo.sbx", PAIR), "--zones"])
    assert result.exit_code == 0
    assert "TA" in result.stdout


def test_the_heads_command_can_show_only_what_is_shared(tmp_path):
    plan = write(tmp_path, "lone.sbx", LONE)
    result = runner.invoke(app, ["heads", plan, "--shared"])
    assert result.exit_code == 0
    assert "E2" not in result.stdout


def test_the_heads_command_copes_with_a_plan_that_has_none(tmp_path):
    result = runner.invoke(app, ["heads", write(tmp_path, "plain.sbx", PLAIN)])
    assert result.exit_code == 0
    assert "J1" not in result.stdout
    counted = runner.invoke(app, ["heads", write(tmp_path, "pair.sbx", PAIR)])
    assert "J1" in counted.stdout


def test_the_heads_command_reads_a_real_scheme(tmp_path):
    result = runner.invoke(app, ["heads", "tests/data/kingsmoor.sbx"])
    assert result.exit_code == 0
    assert "TU" in result.stdout
    assert "P105.reverse" in result.stdout


def test_the_schema_describes_the_two_new_section_fields():
    from signalbox.interchange.schema import describe

    text = describe()
    assert "zone" in text
    assert "heads" in text


def test_a_wide_zone_names_every_section_in_the_file():
    zones = {item["name"]: item.get("zone") for item in exported(WIDE)["sections"]}
    assert zones == {"TA": "TA", "TB": "TA", "TC": "TA"}


def test_a_wide_zone_bounds_only_its_outer_ends():
    heads = {item["name"]: item.get("heads") for item in exported(WIDE)["sections"]}
    assert heads["TA"] == ["A", "J1"]
    assert heads["TB"] == ["J1", "J2"]
    assert heads["TC"] == ["B", "J2"]


def test_the_split_layout_keeps_its_legs_apart_in_the_file():
    zones = {item["name"]: item.get("zone") for item in exported(SPLIT)["sections"]}
    assert zones == {"TA": None, "TB": "TB", "TC": "TC"}


def test_a_route_in_a_wide_zone_still_prints_its_zone_once():
    text = WIDE + '\nsignal D1 on E1 at 400 facing forward direction down aspects 3\n'
    row = report_for(text.replace("direction bidirectional", "direction down")).row("D1(M)")
    assert row.cell("zones") == "TA"


def test_the_kingsmoor_locking_table_still_reads_as_it_did():
    plan = pathlib.Path("tests/data/kingsmoor.sbx").read_text(encoding="utf-8")
    report = build_locking_report(build_interlocking(scheme_from_text(plan)))
    row = report.row("K1(M)")
    assert row.release in ("sectional", "complete")
    assert isinstance(row.cell("zones"), str)


def test_the_examples_still_export_and_validate():
    for name in ("examples/ashcombe.sbx", "examples/ferrybridge-quay.sbx"):
        data = exported(pathlib.Path(name).read_text(encoding="utf-8"))
        assert list(problems(data)) == []
        assert any("zone" in item for item in data["sections"])


def test_an_example_with_counted_sections_carries_its_heads():
    text = pathlib.Path("examples/ashcombe.sbx").read_text(encoding="utf-8")
    data = exported(text)
    counted = [item for item in data["sections"] if item["kind"] == "axle_counter"]
    assert counted
    for item in counted:
        assert item["heads"]
        assert item["zone"] == item["name"]


def test_the_zones_view_can_be_narrowed_to_the_shared_ones(tmp_path):
    plan = write(tmp_path, "lone.sbx", LONE)
    result = runner.invoke(app, ["heads", plan, "--zones", "--shared"])
    assert result.exit_code == 0
    assert "TB" not in result.stdout


def test_the_zones_view_shows_a_wide_zone(tmp_path):
    plan = write(tmp_path, "wide.sbx", WIDE)
    result = runner.invoke(app, ["heads", plan, "--zones", "--shared"])
    assert result.exit_code == 0
    assert "TA" in result.stdout
    assert "TC" in result.stdout


def test_an_unreadable_plan_is_a_clean_error(tmp_path):
    bad = tmp_path / "bad.sbx"
    bad.write_text("node A boundary\nedge E1 from A to NOWHERE length 10\n", encoding="utf-8")
    result = runner.invoke(app, ["heads", str(bad)])
    assert result.exit_code != 0
    good = runner.invoke(app, ["heads", write(tmp_path, "ok.sbx", PAIR)])
    assert good.exit_code == 0
