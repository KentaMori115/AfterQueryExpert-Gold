from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_show_describes_the_scheme():
    result = runner.invoke(app, ["show", PLAN])
    assert result.exit_code == 0
    assert "Kingsmoor Junction" in result.stdout
    assert "20 edges" in result.stdout


def test_show_counts_the_kinds_of_node():
    result = runner.invoke(app, ["show", PLAN])
    assert "6 boundary" in result.stdout
    assert "5 points" in result.stdout
    assert "9 plain" in result.stdout
    assert "1 buffer" in result.stdout


def test_show_gives_the_total_length_of_track():
    result = runner.invoke(app, ["show", PLAN])
    assert "km of track" in result.stdout


def test_detail_lists_the_edges():
    result = runner.invoke(app, ["show", PLAN, "--detail"])
    assert "D1" in result.stdout
    assert "1 in 330" in result.stdout
    assert "90 mph" in result.stdout


def test_without_detail_the_edges_are_not_listed():
    result = runner.invoke(app, ["show", PLAN])
    assert "1 in 330" not in result.stdout


def test_signals_lists_them_with_a_route_count():
    result = runner.invoke(app, ["signals", PLAN])
    assert result.exit_code == 0
    assert "K1" in result.stdout
    assert "shunt" in result.stdout


def test_signals_shows_the_traffic_direction():
    result = runner.invoke(app, ["signals", PLAN])
    assert "down" in result.stdout
    assert "up" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["show", str(tmp_path / "no.sbx")]).exit_code == 2
    assert runner.invoke(app, ["signals", str(tmp_path / "no.sbx")]).exit_code == 2


def test_show_says_what_the_scheme_was_designed_to():
    result = runner.invoke(app, ["show", PLAN])
    assert "designed to overlap 183m" in result.stdout


def test_show_lists_the_crossings():
    result = runner.invoke(app, ["show", "tests/data/marlow-crossing.sbx"])
    assert "level crossings" in result.stdout
    assert "LC21" in result.stdout
    assert "barriers down" in result.stdout


def test_show_lists_the_traps():
    result = runner.invoke(app, ["show", "examples/ferrybridge-quay.sbx"])
    assert "traps" in result.stdout
    assert "TP31" in result.stdout


def test_a_scheme_with_neither_lists_neither():
    result = runner.invoke(app, ["show", PLAN])
    assert "level crossings" not in result.stdout
    assert "TP31" not in result.stdout


def test_the_detail_says_which_way_each_edge_is_worked():
    result = runner.invoke(app, ["show", PLAN, "--detail"])
    assert "worked" in result.stdout
    assert " down " in result.stdout
    assert " up " in result.stdout
