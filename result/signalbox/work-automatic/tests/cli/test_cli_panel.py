from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"
SCRIPT = "tests/data/booked-through.sbs"


def test_the_panel_goes_to_stdout_by_default():
    result = runner.invoke(app, ["panel", PLAN, SCRIPT])
    assert result.exit_code == 0
    assert result.stdout.lstrip().startswith("<svg")


def test_the_signals_and_points_are_drawn():
    result = runner.invoke(app, ["panel", PLAN, SCRIPT])
    assert ">K1<" in result.stdout


def test_a_moment_can_be_chosen():
    early = runner.invoke(app, ["panel", PLAN, SCRIPT, "--at", "10"]).stdout
    late = runner.invoke(app, ["panel", PLAN, SCRIPT, "--at", "80"]).stdout
    assert early != late


def test_the_time_is_in_the_heading():
    result = runner.invoke(app, ["panel", PLAN, SCRIPT, "--at", "60"])
    assert "at 60s" in result.stdout


def test_a_title_can_be_given():
    result = runner.invoke(app, ["panel", PLAN, SCRIPT, "--title", "Just after five"])
    assert "Just after five" in result.stdout


def test_a_moment_outside_the_run_is_a_clean_error():
    result = runner.invoke(app, ["panel", PLAN, SCRIPT, "--at", "99999"])
    assert result.exit_code == 2


def test_the_panel_can_be_written_to_a_file(tmp_path):
    out = tmp_path / "panel.svg"
    result = runner.invoke(app, ["panel", PLAN, SCRIPT, "--out", str(out)])
    assert out.read_text().startswith("<svg")
    assert "wrote" in result.stdout


def test_writing_somewhere_impossible_is_a_clean_error(tmp_path):
    result = runner.invoke(
        app, ["panel", PLAN, SCRIPT, "--out", str(tmp_path / "no" / "p.svg")]
    )
    assert result.exit_code == 2


def test_a_missing_scenario_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["panel", PLAN, str(tmp_path / "no.sbs")])
    assert result.exit_code == 2


def test_a_broken_scenario_is_a_clean_error(tmp_path):
    script = tmp_path / "bad.sbs"
    script.write_text("wibble\n")
    result = runner.invoke(app, ["panel", PLAN, str(script)])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["panel", str(tmp_path / "no.sbx"), SCRIPT])
    assert result.exit_code == 2
