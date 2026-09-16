from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_a_route_is_described():
    result = runner.invoke(app, ["route", PLAN, "K1(M)"])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout


def test_it_says_where_the_route_goes():
    result = runner.invoke(app, ["route", PLAN, "K1(M)"])
    assert "from" in result.stdout
    assert "K3" in result.stdout


def test_it_lists_the_points_and_the_track():
    result = runner.invoke(app, ["route", PLAN, "K1(M)"])
    assert "P103" in result.stdout
    assert "TB-AB" in result.stdout


def test_it_says_what_the_route_locks_out():
    result = runner.invoke(app, ["route", PLAN, "K3(MA)"])
    assert "K3(MB)" in result.stdout


def test_it_gives_the_aspect_sequence():
    result = runner.invoke(app, ["route", PLAN, "K1(M)"])
    assert "aspects" in result.stdout


def test_a_shunt_route_says_it_has_no_aspects():
    result = runner.invoke(app, ["route", PLAN, "K20(S)"])
    assert "shunt" in result.stdout


def test_it_gives_the_gradient_profile():
    result = runner.invoke(app, ["route", PLAN, "K3(MA)"])
    assert "gradient" in result.stdout


def test_a_route_with_no_overlap_says_none():
    result = runner.invoke(app, ["route", PLAN, "K5(M)"])
    assert "none" in result.stdout


def test_an_unknown_route_is_a_clean_error():
    result = runner.invoke(app, ["route", PLAN, "K99(M)"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["route", str(tmp_path / "no.sbx"), "K1(M)"])
    assert result.exit_code == 2


def test_crossings_are_listed_where_there_are_any():
    result = runner.invoke(app, ["route", "tests/data/marlow-crossing.sbx", "M1(M)"])
    assert "barriers down" in result.stdout
