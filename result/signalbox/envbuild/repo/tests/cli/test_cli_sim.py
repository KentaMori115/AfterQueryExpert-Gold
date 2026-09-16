from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"
SCRIPT = "tests/data/down-through-the-junction.sbs"


def test_a_scenario_that_passes_exits_zero():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT])
    assert result.exit_code == 0
    assert "passed" in result.stdout


def test_the_summary_counts_the_events():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT])
    assert "events over" in result.stdout


def test_the_log_can_be_printed():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT, "--log"])
    assert "1A05" in result.stdout
    assert "enters at" in result.stdout


def test_the_log_can_be_narrowed_to_one_kind():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT, "--kind", "route"])
    assert "K1(M)" in result.stdout
    assert "enters at" not in result.stdout


def test_an_unknown_kind_is_a_clean_error():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT, "--kind", "weather"])
    assert result.exit_code == 2


def test_a_scenario_that_fails_exits_nonzero(tmp_path):
    script = tmp_path / "wrong.sbs"
    script.write_text(
        "scenario wrong {\n step 5\n until 20\n}\n"
        "at 0 train 1A05 on D1 at 60\n"
        "expect train 1A05 on D5\n"
    )
    result = runner.invoke(app, ["sim", PLAN, str(script)])
    assert result.exit_code == 1
    assert "failed" in result.stdout


def test_a_missing_scenario_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["sim", PLAN, str(tmp_path / "nope.sbs")])
    assert result.exit_code == 2


def test_a_broken_scenario_is_a_clean_error(tmp_path):
    script = tmp_path / "bad.sbs"
    script.write_text("wibble\n")
    result = runner.invoke(app, ["sim", PLAN, str(script)])
    assert result.exit_code == 2


def test_trains_prints_where_everything_finished():
    result = runner.invoke(app, ["trains", PLAN, SCRIPT])
    assert result.exit_code == 0
    assert "1A05" in result.stdout
    assert "K7" in result.stdout


def test_a_booked_scenario_reports_what_the_setting_did():
    result = runner.invoke(app, ["sim", PLAN, "tests/data/booked-through.sbs"])
    assert result.exit_code == 0
    assert "trains booked" in result.stdout
    assert "routes set" in result.stdout


def test_an_unbooked_scenario_says_nothing_about_setting():
    result = runner.invoke(app, ["sim", PLAN, SCRIPT])
    assert "trains booked" not in result.stdout


def test_the_booked_scenario_takes_the_train_off_at_the_boundary():
    result = runner.invoke(app, ["trains", PLAN, "tests/data/booked-through.sbs"])
    assert "1A05" not in result.stdout
