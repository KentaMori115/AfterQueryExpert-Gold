from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_version_prints_a_version():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert "signalbox" in result.stdout


def test_rules_lists_the_registered_rules():
    result = runner.invoke(app, ["rules"])
    assert result.exit_code == 0
    assert "flank-open" in result.stdout
    assert "detection-gap" in result.stdout


def test_check_reports_findings_and_exits_nonzero():
    result = runner.invoke(app, ["check", PLAN])
    assert result.exit_code == 1
    assert "flank-open" in result.stdout
    assert "rules ran" in result.stdout


def test_check_can_be_narrowed_to_one_rule():
    result = runner.invoke(app, ["check", PLAN, "--only", "detection-gap"])
    assert result.exit_code == 0
    assert "1 rules ran, nothing found" in result.stdout


def test_check_can_skip_rules():
    result = runner.invoke(app, ["check", PLAN, "--skip", "flank-open"])
    assert "flank-open" not in result.stdout


def test_quiet_prints_the_summary_only():
    result = runner.invoke(app, ["check", PLAN, "--quiet"])
    assert "rules ran" in result.stdout
    assert "flank-open" not in result.stdout


def test_an_unknown_rule_is_a_clean_error():
    result = runner.invoke(app, ["check", PLAN, "--only", "nonsense"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["check", str(tmp_path / "nothing.sbx")])
    assert result.exit_code == 2


def test_a_broken_plan_is_a_clean_error(tmp_path):
    bad = tmp_path / "bad.sbx"
    bad.write_text("node A boundary\nedge E1 from A to Z length 10\n")
    result = runner.invoke(app, ["check", str(bad)])
    assert result.exit_code == 2


def test_routes_lists_them():
    result = runner.invoke(app, ["routes", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "K3(MB)" in result.stdout


def test_routes_can_be_filtered_by_signal():
    result = runner.invoke(app, ["routes", PLAN, "--signal", "K3"])
    assert "K3(MA)" in result.stdout
    assert "K1(M)" not in result.stdout


def test_routes_from_a_signal_with_none_is_an_error():
    result = runner.invoke(app, ["routes", PLAN, "--signal", "K99"])
    assert result.exit_code == 2
