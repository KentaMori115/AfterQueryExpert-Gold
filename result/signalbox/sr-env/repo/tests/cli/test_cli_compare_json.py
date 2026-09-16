import json

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


@pytest.fixture
def exported(tmp_path):
    path = tmp_path / "kingsmoor.sbj"
    runner.invoke(app, ["export", PLAN, "--out", str(path)])
    return path


@pytest.fixture
def changed(tmp_path, exported):
    data = json.loads(exported.read_text())
    data["routes"] = [route for route in data["routes"] if route["name"] != "K7(M)"]
    path = tmp_path / "changed.sbj"
    path.write_text(json.dumps(data))
    return path


def test_comparing_a_file_with_itself_says_the_same(exported):
    result = runner.invoke(app, ["compare", str(exported), str(exported), "-f", "json"])
    found = json.loads(result.stdout)
    assert found["same"] is True
    assert found["summary"] == "identical"
    assert result.exit_code == 0


def test_a_difference_comes_out_as_json(exported, changed):
    result = runner.invoke(app, ["compare", str(exported), str(changed), "-f", "json"])
    found = json.loads(result.stdout)
    assert found["removed"] == ["K7(M)"]
    assert found["same"] is False
    assert result.exit_code == 1


def test_the_routes_touched_are_listed(exported, changed):
    result = runner.invoke(app, ["compare", str(exported), str(changed), "-f", "json"])
    assert "K7(M)" in json.loads(result.stdout)["routes_touched"]


def test_changed_fields_carry_both_values(tmp_path, exported):
    data = json.loads(exported.read_text())
    data["routes"][0]["release"] = "complete"
    other = tmp_path / "other.sbj"
    other.write_text(json.dumps(data))
    result = runner.invoke(app, ["compare", str(exported), str(other), "-f", "json"])
    changed = json.loads(result.stdout)["changed"]
    assert changed[0]["field"] == "release"
    assert changed[0]["before"] == "sectional"
    assert changed[0]["after"] == "complete"


def test_an_unknown_format_is_a_clean_error(exported):
    result = runner.invoke(app, ["compare", str(exported), str(exported), "-f", "yaml"])
    assert result.exit_code == 2


def test_the_text_form_still_works(exported, changed):
    result = runner.invoke(app, ["compare", str(exported), str(changed)])
    assert "removed K7(M)" in result.stdout


def test_the_json_is_not_wrapped(exported, changed):
    result = runner.invoke(app, ["compare", str(exported), str(changed), "-f", "json"])
    json.loads(result.stdout)
