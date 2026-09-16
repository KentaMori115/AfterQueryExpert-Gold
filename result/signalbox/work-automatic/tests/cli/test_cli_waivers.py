import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


@pytest.fixture
def waiver_file(tmp_path):
    path = tmp_path / "waivers.txt"
    path.write_text(runner.invoke(app, ["check", PLAN, "--accept"]).stdout)
    return path


def test_accept_prints_a_waiver_file():
    result = runner.invoke(app, ["check", PLAN, "--accept"])
    assert result.exit_code == 0
    assert result.stdout.startswith("# written by signalbox")
    assert "flank-open" in result.stdout


def test_a_waiver_file_takes_the_findings_out(waiver_file):
    result = runner.invoke(app, ["check", PLAN, "--waivers", str(waiver_file)])
    assert result.exit_code == 0
    assert "nothing found" in result.stdout


def test_the_number_of_waivers_is_reported(waiver_file):
    result = runner.invoke(app, ["check", PLAN, "--waivers", str(waiver_file)])
    assert "waivers applied" in result.stdout


def test_a_waiver_for_something_else_leaves_the_findings(tmp_path):
    path = tmp_path / "waivers.txt"
    path.write_text("flank-open K99(M)   nothing to do with anything\n")
    result = runner.invoke(app, ["check", PLAN, "--waivers", str(path)])
    assert result.exit_code == 1
    assert "flank-open" in result.stdout


def test_a_broken_waiver_file_is_a_clean_error(tmp_path):
    path = tmp_path / "waivers.txt"
    path.write_text("flank-open\n")
    result = runner.invoke(app, ["check", PLAN, "--waivers", str(path)])
    assert result.exit_code == 2


def test_a_missing_waiver_file_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["check", PLAN, "--waivers", str(tmp_path / "no.txt")])
    assert result.exit_code == 2


def test_waivers_and_only_work_together(waiver_file):
    result = runner.invoke(
        app, ["check", PLAN, "--only", "flank-open", "--waivers", str(waiver_file)]
    )
    assert result.exit_code == 0


def test_the_waiver_file_round_trips(waiver_file):
    again = runner.invoke(app, ["check", PLAN, "--accept"]).stdout
    assert again == waiver_file.read_text()


def test_a_long_waiver_line_is_not_wrapped():
    result = runner.invoke(app, ["check", PLAN, "--accept"])
    for line in result.stdout.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        assert len(line.split()) >= 2, line


def test_raw_output_is_not_wrapped_by_the_terminal():
    table = runner.invoke(app, ["table", PLAN, "--format", "csv"]).stdout
    for line in table.splitlines():
        assert "," in line, line
