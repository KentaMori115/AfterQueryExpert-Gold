from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_locking_prints_a_row_per_route():
    result = runner.invoke(app, ["locking", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "TB-AB" in result.stdout


def test_one_route_can_be_singled_out():
    result = runner.invoke(app, ["locking", PLAN, "--route", "K1(M)"])
    assert "K1(M)" in result.stdout
    assert "K3(MA)" not in result.stdout


def test_an_unknown_route_is_a_clean_error():
    result = runner.invoke(app, ["locking", PLAN, "--route", "K99(M)"])
    assert result.exit_code == 2


def test_sectional_narrows_the_list():
    everything = runner.invoke(app, ["locking", PLAN]).stdout
    only = runner.invoke(app, ["locking", PLAN, "--sectional"]).stdout
    assert len(only) < len(everything)


def test_the_holders_of_a_subroute_can_be_asked_for():
    result = runner.invoke(app, ["locking", PLAN, "--subroute", "TB-AB"])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout


def test_a_subroute_nothing_holds_is_a_clean_error():
    result = runner.invoke(app, ["locking", PLAN, "--subroute", "TZ-AB"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["locking", str(tmp_path / "no.sbx")]).exit_code == 2
