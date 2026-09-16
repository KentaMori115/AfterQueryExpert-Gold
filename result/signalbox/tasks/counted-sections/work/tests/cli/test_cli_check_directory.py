"""Checking a whole directory of plans at once, which is what an area is."""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()


@pytest.fixture
def area(tmp_path):
    good = (
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 900 direction down\n"
        "section TA over E1\n"
    )
    (tmp_path / "one.sbx").write_text(good)
    (tmp_path / "two.sbx").write_text(good.replace("E1", "E2").replace("TA", "TB"))
    (tmp_path / "notes.txt").write_text("ignore me")
    return tmp_path


def test_a_single_plan_still_works():
    result = runner.invoke(app, ["check", "tests/data/kingsmoor.sbx", "--quiet"])
    assert result.exit_code in (0, 1)
    assert "rules ran" in result.stdout


def test_every_plan_in_a_directory_is_checked(area):
    result = runner.invoke(app, ["check", str(area), "--quiet"])
    assert result.exit_code in (0, 1)


def test_findings_say_which_plan_they_came_from(area):
    (area / "bad.sbx").write_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 900 direction down\n"
        "section TA over E1\n"
        "signal S1 on E1 at 400 facing backward direction down\n"
    )
    result = runner.invoke(app, ["check", str(area)])
    assert "bad:S1" in result.stdout


def test_a_directory_with_no_plans_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["check", str(tmp_path)])
    assert result.exit_code == 2


def test_a_broken_plan_in_the_directory_is_a_clean_error(area):
    (area / "broken.sbx").write_text("node A boundary\nedge E1 from A to Z length 10\n")
    result = runner.invoke(app, ["check", str(area)])
    assert result.exit_code == 2


def test_json_works_for_a_directory_too(area):
    result = runner.invoke(app, ["check", str(area), "--format", "json"])
    assert json.loads(result.stdout)["findings"] is not None


def test_the_examples_directory_can_be_checked():
    result = runner.invoke(app, ["check", "examples", "--quiet"])
    assert result.exit_code in (0, 1)
    assert "rules ran" in result.stdout
