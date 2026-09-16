from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_the_report_goes_to_stdout_by_default():
    result = runner.invoke(app, ["report", PLAN])
    assert "Kingsmoor Junction" in result.stdout
    assert "Layout" in result.stdout
    assert "Routes" in result.stdout


def test_the_report_includes_findings_by_default():
    result = runner.invoke(app, ["report", PLAN])
    assert "Findings" in result.stdout
    assert result.exit_code == 1


def test_findings_can_be_left_out():
    result = runner.invoke(app, ["report", PLAN, "--no-findings"])
    assert "Findings" not in result.stdout
    assert result.exit_code == 0


def test_the_report_can_be_written_to_a_file(tmp_path):
    out = tmp_path / "report.txt"
    result = runner.invoke(app, ["report", PLAN, "--out", str(out)])
    assert "Kingsmoor Junction" in out.read_text()
    assert "wrote" in result.stdout


def test_writing_somewhere_impossible_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["report", PLAN, "--out", str(tmp_path / "no" / "r.txt")])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["report", str(tmp_path / "no.sbx")]).exit_code == 2


def test_the_pack_includes_the_report(tmp_path):
    out = tmp_path / "pack"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    assert (out / "report.txt").exists()
    assert "Kingsmoor Junction" in (out / "report.txt").read_text()
