"""Reporting only what is new since a findings file was written."""

from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.interchange.findings import FindingsError, keys_in, read
from signalbox.interchange.findings import loads as load_findings

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


@pytest.fixture
def baseline(tmp_path):
    path = tmp_path / "findings.json"
    path.write_text(runner.invoke(app, ["check", PLAN, "--format", "json"]).stdout)
    return path


def test_nothing_is_new_against_its_own_findings(baseline):
    result = runner.invoke(app, ["check", PLAN, "--since", str(baseline)])
    assert result.exit_code == 0
    assert "nothing found" in result.stdout


def test_a_new_finding_shows_up(tmp_path, baseline):
    data = json.loads(baseline.read_text())
    data["findings"] = [f for f in data["findings"] if f["rule"] != "flank-open"]
    trimmed = tmp_path / "trimmed.json"
    trimmed.write_text(json.dumps(data))
    result = runner.invoke(app, ["check", PLAN, "--since", str(trimmed)])
    assert result.exit_code == 1
    assert "flank-open" in result.stdout


def test_the_keys_of_a_findings_file_can_be_read(baseline):
    found = keys_in(json.loads(baseline.read_text()))
    assert ("flank-open", "K3(MA)") in found


def test_a_file_with_no_findings_key_is_refused():
    with pytest.raises(FindingsError, match="not a findings file"):
        load_findings("{}")


def test_rubbish_is_refused():
    with pytest.raises(FindingsError, match="not valid JSON"):
        load_findings("{definitely not")


def test_a_file_from_the_future_is_refused():
    with pytest.raises(FindingsError, match="later version"):
        load_findings(json.dumps({"findings": [], "findings_version": 99}))


def test_a_missing_file_is_reported(tmp_path):
    with pytest.raises(FindingsError, match="cannot read"):
        read(tmp_path / "nothing.json")


def test_a_missing_file_is_a_clean_error_from_the_command(tmp_path):
    result = runner.invoke(app, ["check", PLAN, "--since", str(tmp_path / "no.json")])
    assert result.exit_code == 2


def test_since_works_with_json_output(baseline):
    result = runner.invoke(app, ["check", PLAN, "--since", str(baseline), "--format", "json"])
    assert json.loads(result.stdout)["findings"] == []


def test_since_and_waivers_can_be_used_together(baseline):
    result = runner.invoke(app, ["check", PLAN, "--since", str(baseline), "--quiet"])
    assert result.exit_code == 0
