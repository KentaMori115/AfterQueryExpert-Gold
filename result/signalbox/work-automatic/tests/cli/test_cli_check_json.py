import json

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


@pytest.fixture
def found():
    result = runner.invoke(app, ["check", PLAN, "--format", "json"])
    return json.loads(result.stdout)


def test_json_comes_out_as_json(found):
    assert found["findings_version"] == 1
    assert isinstance(found["findings"], list)


def test_the_scheme_is_named(found):
    assert found["scheme"] == "kingsmoor"


def test_the_rules_that_ran_are_listed(found):
    assert "flank-open" in found["rules_run"]


def test_the_counts_add_up(found):
    assert sum(found["counts"].values()) == len(found["findings"])


def test_a_scheme_with_errors_exits_nonzero():
    result = runner.invoke(app, ["check", PLAN, "--format", "json"])
    assert result.exit_code == 1
    assert result.stdout.lstrip().startswith("{")


def test_the_explanation_can_be_asked_for():
    result = runner.invoke(app, ["check", PLAN, "--format", "json", "--explain"])
    found = json.loads(result.stdout)
    assert any("fix" in finding for finding in found["findings"])


def test_without_explain_there_is_no_advice(found):
    assert all("fix" not in finding for finding in found["findings"])


def test_waivers_come_through_in_the_json(tmp_path):
    waivers = tmp_path / "waivers.txt"
    waivers.write_text(runner.invoke(app, ["check", PLAN, "--accept"]).stdout)
    result = runner.invoke(app, ["check", PLAN, "--format", "json", "--waivers", str(waivers)])
    found = json.loads(result.stdout)
    assert found["ok"] is True
    assert found["accepted"] == []
    assert found["findings"] == []


def test_only_one_rule_can_be_run():
    result = runner.invoke(app, ["check", PLAN, "--format", "json", "--only", "detection-gap"])
    found = json.loads(result.stdout)
    assert found["rules_run"] == ["detection-gap"]
    assert result.exit_code == 0


def test_an_unknown_format_is_a_clean_error():
    result = runner.invoke(app, ["check", PLAN, "--format", "yaml"])
    assert result.exit_code == 2


def test_the_json_is_not_wrapped_by_the_terminal():
    result = runner.invoke(app, ["check", PLAN, "--format", "json"])
    json.loads(result.stdout)


def test_strict_makes_warnings_count():
    lenient = runner.invoke(app, ["check", PLAN, "--only", "overlap-short", "--quiet"])
    strict = runner.invoke(
        app, ["check", PLAN, "--only", "overlap-short", "--quiet", "--strict"]
    )
    assert lenient.exit_code == 0
    assert strict.exit_code == 1


def test_strict_says_why_it_failed():
    result = runner.invoke(app, ["check", PLAN, "--only", "overlap-short", "--strict"])
    assert "warnings are errors" in result.stdout


def test_strict_changes_the_exit_code_in_json_too():
    result = runner.invoke(
        app, ["check", PLAN, "--only", "overlap-short", "-f", "json", "--strict"]
    )
    assert result.exit_code == 1


def test_strict_on_a_clean_run_still_passes():
    result = runner.invoke(app, ["check", PLAN, "--only", "detection-gap", "--strict"])
    assert result.exit_code == 0
