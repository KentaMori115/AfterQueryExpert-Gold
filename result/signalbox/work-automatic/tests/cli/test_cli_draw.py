from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"
SCRIPT = "tests/data/down-through-the-junction.sbs"


def test_drawing_goes_to_stdout_by_default():
    result = runner.invoke(app, ["draw", PLAN])
    assert result.exit_code == 0
    assert result.stdout.lstrip().startswith("<svg")


def test_drawing_can_be_written_to_a_file(tmp_path):
    out = tmp_path / "kingsmoor.svg"
    result = runner.invoke(app, ["draw", PLAN, "--out", str(out)])
    assert result.exit_code == 0
    assert out.read_text().startswith("<svg")
    assert "wrote" in result.stdout


def test_the_scale_changes_the_width(tmp_path):
    narrow = runner.invoke(app, ["draw", PLAN, "--scale", "0.02"]).stdout
    wide = runner.invoke(app, ["draw", PLAN, "--scale", "0.2"]).stdout
    assert len(wide) >= len(narrow)


def test_a_title_appears_in_the_drawing():
    result = runner.invoke(app, ["draw", PLAN, "--title", "Stage 2 commissioning"])
    assert "Stage 2 commissioning" in result.stdout


def test_a_datum_can_be_chosen():
    result = runner.invoke(app, ["draw", PLAN, "--datum", "WU"])
    assert result.exit_code == 0


def test_an_unknown_datum_is_a_clean_error():
    result = runner.invoke(app, ["draw", PLAN, "--datum", "nowhere"])
    assert result.exit_code == 2


def test_a_silly_scale_is_a_clean_error():
    result = runner.invoke(app, ["draw", PLAN, "--scale", "0"])
    assert result.exit_code == 2


def test_a_scenario_can_be_run_first():
    result = runner.invoke(app, ["draw", PLAN, "--after", SCRIPT])
    assert result.exit_code == 0
    assert "<svg" in result.stdout


def test_a_missing_scenario_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["draw", PLAN, "--after", str(tmp_path / "no.sbs")])
    assert result.exit_code == 2


def test_a_broken_scenario_is_a_clean_error(tmp_path):
    script = tmp_path / "bad.sbs"
    script.write_text("wibble\n")
    result = runner.invoke(app, ["draw", PLAN, "--after", str(script)])
    assert result.exit_code == 2


def test_writing_somewhere_impossible_is_a_clean_error(tmp_path):
    result = runner.invoke(
        app, ["draw", PLAN, "--out", str(tmp_path / "no" / "such" / "x.svg")]
    )
    assert result.exit_code == 2


def test_a_key_can_be_asked_for():
    result = runner.invoke(app, ["draw", PLAN, "--legend"])
    assert result.exit_code == 0
    assert ">key<" in result.stdout


def test_without_the_flag_there_is_no_key():
    result = runner.invoke(app, ["draw", PLAN])
    assert ">key<" not in result.stdout
