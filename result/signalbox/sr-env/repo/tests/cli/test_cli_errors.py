"""A bad plan has to say which line is bad, and show it."""

from __future__ import annotations

from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner(mix_stderr=True)

BAD_LENGTH = "node A boundary\nnode B boundary\nedge E1 from A to B speed 40\n"
BAD_REFERENCE = "node A boundary\nedge E1 from A to Z length 10\n"
BAD_SYNTAX = "node A boundary\nwibble\n"


def write(tmp_path, text, name="plan.sbx"):
    path = tmp_path / name
    path.write_text(text)
    return str(path)


def test_a_missing_length_names_the_line(tmp_path):
    result = runner.invoke(app, ["check", write(tmp_path, BAD_LENGTH)])
    assert result.exit_code == 2
    assert "plan.sbx:3" in result.stdout


def test_the_offending_line_is_printed(tmp_path):
    result = runner.invoke(app, ["check", write(tmp_path, BAD_LENGTH)])
    assert "edge E1 from A to B speed 40" in result.stdout


def test_the_line_is_marked(tmp_path):
    result = runner.invoke(app, ["check", write(tmp_path, BAD_LENGTH)])
    assert "> 3 |" in result.stdout


def test_an_unknown_reference_is_shown_the_same_way(tmp_path):
    result = runner.invoke(app, ["check", write(tmp_path, BAD_REFERENCE)])
    assert "unknown node Z" in result.stdout
    assert "> 2 |" in result.stdout


def test_a_syntax_error_is_shown_the_same_way(tmp_path):
    result = runner.invoke(app, ["check", write(tmp_path, BAD_SYNTAX)])
    assert "unknown declaration" in result.stdout
    assert "wibble" in result.stdout


def test_every_command_that_loads_a_plan_shows_the_line(tmp_path):
    plan = write(tmp_path, BAD_LENGTH)
    for command in ("check", "routes", "table", "draw", "report", "show"):
        result = runner.invoke(app, [command, plan])
        assert result.exit_code == 2, command
        assert "plan.sbx:3" in result.stdout, command


def test_a_missing_file_still_says_so_plainly(tmp_path):
    result = runner.invoke(app, ["check", str(tmp_path / "nothing.sbx")])
    assert result.exit_code == 2
    assert "cannot read" in result.stdout
    assert "> 1 |" not in result.stdout


def test_a_good_plan_prints_no_error(tmp_path):
    good = write(
        tmp_path,
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\nsection TA over E1\n",
    )
    result = runner.invoke(app, ["show", good])
    assert result.exit_code == 0
    assert "error:" not in result.stdout
