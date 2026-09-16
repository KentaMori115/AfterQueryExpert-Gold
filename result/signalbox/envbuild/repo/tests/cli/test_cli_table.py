from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_the_table_prints_every_route():
    result = runner.invoke(app, ["table", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "K22(S)" in result.stdout


def test_the_table_has_a_heading_row():
    result = runner.invoke(app, ["table", PLAN, "--columns", "route,from,to"])
    lines = result.stdout.splitlines()
    assert lines[0].split() == ["route", "from", "to"]


def test_csv_is_machine_readable():
    result = runner.invoke(app, ["table", PLAN, "--format", "csv", "--columns", "route,from"])
    assert result.stdout.splitlines()[0] == "route,from"
    assert "K1(M),K1" in result.stdout


def test_markdown_comes_out_as_a_pipe_table():
    result = runner.invoke(app, ["table", PLAN, "--format", "markdown", "--columns", "route"])
    assert "| route |" in result.stdout
    assert "| --- |" in result.stdout


def test_narrow_is_a_shorthand_for_a_column_set():
    result = runner.invoke(app, ["table", PLAN, "--columns", "narrow"])
    assert "points normal" in result.stdout
    assert "approach" not in result.stdout


def test_one_route_can_be_singled_out():
    result = runner.invoke(app, ["table", PLAN, "--route", "K1(M)", "--columns", "route"])
    assert "K1(M)" in result.stdout
    assert "K3(MA)" not in result.stdout


def test_an_unknown_route_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--route", "K99(M)"])
    assert result.exit_code == 2


def test_an_unknown_format_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--format", "postscript"])
    assert result.exit_code == 2


def test_an_unknown_column_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--columns", "route,weather"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["table", str(tmp_path / "nope.sbx")])
    assert result.exit_code == 2


def test_the_table_can_be_sorted_by_a_column():
    result = runner.invoke(app, ["table", PLAN, "--sort", "class", "--columns", "class,route"])
    classes = [line.split()[0] for line in result.stdout.splitlines()[2:] if line.strip()]
    assert classes == sorted(classes)


def test_the_table_can_be_sorted_by_two_columns():
    result = runner.invoke(
        app, ["table", PLAN, "--sort", "class", "--sort", "route", "--columns", "class,route"]
    )
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout


def test_rows_can_be_filtered():
    result = runner.invoke(app, ["table", PLAN, "--where", "route=K3", "--columns", "route"])
    assert "K3(MA)" in result.stdout
    assert "K1(M)" not in result.stdout


def test_several_filters_are_all_applied():
    result = runner.invoke(
        app, ["table", PLAN, "--where", "class=S", "--where", "route=K20", "--columns", "route"]
    )
    assert "K20(S)" in result.stdout
    assert "K22(S)" not in result.stdout


def test_a_filter_that_matches_nothing_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--where", "route=nothing"])
    assert result.exit_code == 2


def test_a_filter_with_no_equals_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--where", "route"])
    assert result.exit_code == 2


def test_sorting_by_a_column_that_is_not_there_is_a_clean_error():
    result = runner.invoke(app, ["table", PLAN, "--sort", "weather"])
    assert result.exit_code == 2
