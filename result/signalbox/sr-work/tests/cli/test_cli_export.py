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


def test_export_writes_json_to_stdout():
    result = runner.invoke(app, ["export", PLAN])
    assert result.exit_code == 0
    assert '"schema"' in result.stdout


def test_export_writes_to_a_file(exported):
    data = json.loads(exported.read_text())
    assert data["scheme"]["name"] == "kingsmoor"


def test_export_reports_what_it_wrote(tmp_path):
    out = tmp_path / "out.sbj"
    result = runner.invoke(app, ["export", PLAN, "--out", str(out)])
    assert "wrote" in result.stdout
    assert "bytes" in result.stdout


def test_the_fingerprint_can_be_asked_for_on_its_own():
    result = runner.invoke(app, ["export", PLAN, "--fingerprint"])
    assert result.exit_code == 0
    assert len(result.stdout.strip()) == 12


def test_writing_somewhere_impossible_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["export", PLAN, "--out", str(tmp_path / "no" / "x.sbj")])
    assert result.exit_code == 2


def test_comparing_a_file_with_itself_is_identical(exported):
    result = runner.invoke(app, ["compare", str(exported), str(exported)])
    assert result.exit_code == 0
    assert "identical" in result.stdout


def test_a_difference_exits_nonzero(tmp_path, exported):
    changed = json.loads(exported.read_text())
    changed["routes"] = [r for r in changed["routes"] if r["name"] != "K7(M)"]
    other = tmp_path / "other.sbj"
    other.write_text(json.dumps(changed))
    result = runner.invoke(app, ["compare", str(exported), str(other)])
    assert result.exit_code == 1
    assert "removed K7(M)" in result.stdout


def test_summary_prints_the_counts_only(tmp_path, exported):
    changed = json.loads(exported.read_text())
    changed["routes"] = [r for r in changed["routes"] if r["name"] != "K7(M)"]
    other = tmp_path / "other.sbj"
    other.write_text(json.dumps(changed))
    result = runner.invoke(app, ["compare", str(exported), str(other), "--summary"])
    assert "1 removed" in result.stdout
    assert "removed K7(M)" not in result.stdout


def test_comparing_something_that_is_not_an_interchange_file(tmp_path, exported):
    rubbish = tmp_path / "rubbish.sbj"
    rubbish.write_text("{}")
    result = runner.invoke(app, ["compare", str(exported), str(rubbish)])
    assert result.exit_code == 2


def test_comparing_a_missing_file(tmp_path, exported):
    result = runner.invoke(app, ["compare", str(exported), str(tmp_path / "no.sbj")])
    assert result.exit_code == 2
