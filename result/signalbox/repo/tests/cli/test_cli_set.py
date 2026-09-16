from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_a_route_that_can_be_set_is_set():
    result = runner.invoke(app, ["set", PLAN, "K1(M)"])
    assert result.exit_code == 0
    assert "set" in result.stdout
    assert "1 routes held" in result.stdout


def test_the_aspect_the_signal_takes_is_shown():
    result = runner.invoke(app, ["set", PLAN, "K1(M)"])
    assert "Y" in result.stdout


def test_two_routes_in_sequence_are_both_set():
    result = runner.invoke(app, ["set", PLAN, "K1(M)", "K3(MA)"])
    assert result.exit_code == 0
    assert "2 routes held" in result.stdout


def test_a_conflicting_route_is_refused_with_a_reason():
    result = runner.invoke(app, ["set", PLAN, "K3(MA)", "K3(MB)"])
    assert result.exit_code == 1
    assert "refused" in result.stdout
    assert "set against it" in result.stdout


def test_occupied_track_can_be_declared():
    result = runner.invoke(app, ["set", PLAN, "K1(M)", "--occupied", "TB"])
    assert result.exit_code == 1
    assert "occupied" in result.stdout


def test_an_unknown_section_is_a_clean_error():
    result = runner.invoke(app, ["set", PLAN, "K1(M)", "--occupied", "TZ"])
    assert result.exit_code == 2


def test_an_unknown_route_is_a_clean_error():
    result = runner.invoke(app, ["set", PLAN, "K99(M)"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["set", str(tmp_path / "no.sbx"), "K1(M)"])
    assert result.exit_code == 2
