from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_two_signals_are_measured():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3"])
    assert result.exit_code == 0
    assert "500" in result.stdout


def test_the_answer_comes_in_yards_and_chains_too():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3"])
    assert "yards" in result.stdout
    assert "ch" in result.stdout


def test_the_edges_walked_are_listed():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3"])
    assert "D2" in result.stdout


def test_the_points_can_be_thrown_over():
    normal = runner.invoke(app, ["distance", PLAN, "K3", "K5"]).stdout
    reverse = runner.invoke(app, ["distance", PLAN, "K3", "K7", "--reverse", "P101"]).stdout
    assert normal != reverse


def test_unknown_points_are_a_clean_error():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3", "--reverse", "P999"])
    assert result.exit_code == 2


def test_something_that_is_not_there_is_a_clean_error():
    result = runner.invoke(app, ["distance", PLAN, "K1", "wibble"])
    assert result.exit_code == 2


def test_somewhere_out_of_reach_exits_nonzero():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3", "--limit", "10"])
    assert result.exit_code == 1
    assert "no way from" in result.stdout


def test_a_silly_limit_is_a_clean_error():
    result = runner.invoke(app, ["distance", PLAN, "K1", "K3", "--limit", "0"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["distance", str(tmp_path / "no.sbx"), "K1", "K3"])
    assert result.exit_code == 2
