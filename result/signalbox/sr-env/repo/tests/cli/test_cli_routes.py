from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_routes_lists_them_all():
    result = runner.invoke(app, ["routes", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "K20(S)" in result.stdout


def test_routes_can_be_filtered_by_exit():
    result = runner.invoke(app, ["routes", PLAN, "--to", "K3"])
    assert "K1(M)" in result.stdout
    assert "K3(MA)" not in result.stdout


def test_an_exit_nothing_reaches_is_a_clean_error():
    result = runner.invoke(app, ["routes", PLAN, "--to", "K99"])
    assert result.exit_code == 2


def test_routes_can_be_filtered_by_class():
    result = runner.invoke(app, ["routes", PLAN, "--class", "S"])
    assert "K20(S)" in result.stdout
    assert "K1(M)" not in result.stdout


def test_the_class_letter_is_not_case_sensitive():
    upper = runner.invoke(app, ["routes", PLAN, "--class", "S"]).stdout
    lower = runner.invoke(app, ["routes", PLAN, "--class", "s"]).stdout
    assert upper == lower


def test_an_unknown_class_is_a_clean_error():
    result = runner.invoke(app, ["routes", PLAN, "--class", "Z"])
    assert result.exit_code == 2


def test_a_class_nothing_uses_is_a_clean_error():
    result = runner.invoke(app, ["routes", PLAN, "--class", "W"])
    assert result.exit_code == 2


def test_routes_can_be_filtered_by_section():
    result = runner.invoke(app, ["routes", PLAN, "--over", "TB"])
    assert "K1(M)" in result.stdout
    assert "K2(M)" not in result.stdout


def test_an_unknown_section_is_a_clean_error():
    result = runner.invoke(app, ["routes", PLAN, "--over", "TZ"])
    assert result.exit_code == 2


def test_a_section_no_route_runs_over_is_a_clean_error():
    result = runner.invoke(app, ["routes", PLAN, "--over", "TA"])
    assert result.exit_code == 2


def test_the_filters_can_be_combined():
    result = runner.invoke(app, ["routes", PLAN, "--signal", "K3", "--class", "M"])
    assert "K3(MA)" in result.stdout
    assert "K1(M)" not in result.stdout
