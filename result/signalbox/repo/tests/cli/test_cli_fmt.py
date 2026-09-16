from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"

MESSY = "node   A boundary\nnode B boundary\nedge E1 from A to B length 400\n"
TIDY = "node A boundary\nnode B boundary\n\nedge E1 from A to B length 400\n"


def test_formatting_prints_the_tidy_version(tmp_path):
    plan = tmp_path / "messy.sbx"
    plan.write_text(MESSY)
    result = runner.invoke(app, ["fmt", str(plan)])
    assert result.exit_code == 0
    assert result.stdout == TIDY


def test_a_file_that_is_already_tidy_prints_nothing(tmp_path):
    plan = tmp_path / "tidy.sbx"
    plan.write_text(TIDY)
    result = runner.invoke(app, ["fmt", str(plan)])
    assert result.stdout == ""


def test_check_says_what_would_change(tmp_path):
    plan = tmp_path / "messy.sbx"
    plan.write_text(MESSY)
    result = runner.invoke(app, ["fmt", str(plan), "--check"])
    assert result.exit_code == 1
    assert "would reformat" in result.stdout
    assert plan.read_text() == MESSY


def test_check_on_a_tidy_file_exits_zero(tmp_path):
    plan = tmp_path / "tidy.sbx"
    plan.write_text(TIDY)
    result = runner.invoke(app, ["fmt", str(plan), "--check"])
    assert result.exit_code == 0
    assert "0 of 1 files" in result.stdout


def test_write_rewrites_the_file(tmp_path):
    plan = tmp_path / "messy.sbx"
    plan.write_text(MESSY)
    result = runner.invoke(app, ["fmt", str(plan), "--write"])
    assert result.exit_code == 0
    assert plan.read_text() == TIDY
    assert "reformatted" in result.stdout


def test_a_directory_formats_every_plan_in_it(tmp_path):
    (tmp_path / "one.sbx").write_text(MESSY)
    (tmp_path / "two.sbx").write_text(MESSY)
    (tmp_path / "notes.txt").write_text("ignore me")
    result = runner.invoke(app, ["fmt", str(tmp_path), "--check"])
    assert "2 of 2 files" in result.stdout


def test_an_empty_directory_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["fmt", str(tmp_path)])
    assert result.exit_code == 2


def test_a_missing_file_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["fmt", str(tmp_path / "no.sbx")])
    assert result.exit_code == 2


def test_a_broken_plan_is_a_clean_error(tmp_path):
    plan = tmp_path / "bad.sbx"
    plan.write_text("node A boundary\nedge E1 from A to Z length 10\n")
    result = runner.invoke(app, ["fmt", str(plan)])
    assert result.exit_code == 2


def test_the_fixture_plan_survives_a_round_trip(tmp_path):
    import shutil

    copy = tmp_path / "kingsmoor.sbx"
    shutil.copy(PLAN, copy)
    runner.invoke(app, ["fmt", str(copy), "--write"])
    again = runner.invoke(app, ["fmt", str(copy), "--check"])
    assert again.exit_code == 0
    assert runner.invoke(app, ["check", str(copy), "--quiet"]).exit_code in (0, 1)
