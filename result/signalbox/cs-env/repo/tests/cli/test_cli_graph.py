from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"
SCRIPT = "tests/data/booked-through.sbs"


def test_the_graph_goes_to_stdout_by_default():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT])
    assert result.exit_code == 0
    assert result.stdout.lstrip().startswith("<svg")


def test_the_train_appears_on_the_graph():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT])
    assert ">1A05<" in result.stdout


def test_the_scenario_name_is_the_default_title():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT])
    assert "booked through the junction" in result.stdout


def test_a_title_can_be_given():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT, "--title", "Down peak"])
    assert "Down peak" in result.stdout


def test_the_graph_can_be_written_to_a_file(tmp_path):
    out = tmp_path / "graph.svg"
    result = runner.invoke(app, ["graph", PLAN, SCRIPT, "--out", str(out)])
    assert result.exit_code == 0
    assert out.read_text().startswith("<svg")
    assert "fixes for" in result.stdout


def test_the_size_can_be_chosen():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT, "--width", "300", "--height", "200"])
    assert 'width="400"' in result.stdout


def test_a_silly_size_is_a_clean_error():
    result = runner.invoke(app, ["graph", PLAN, SCRIPT, "--width", "0"])
    assert result.exit_code == 2


def test_a_failing_scenario_still_draws_but_exits_nonzero(tmp_path):
    script = tmp_path / "wrong.sbs"
    script.write_text(
        "scenario wrong {\n step 5\n until 20\n}\n"
        "at 0 train 1A05 on D1 at 60\n"
        "expect train 1A05 on D5\n"
    )
    result = runner.invoke(app, ["graph", PLAN, str(script)])
    assert result.exit_code == 1
    assert "<svg" in result.stdout


def test_a_scenario_with_no_trains_is_a_clean_error(tmp_path):
    script = tmp_path / "empty.sbs"
    script.write_text("scenario empty {\n step 5\n until 20\n}\n")
    result = runner.invoke(app, ["graph", PLAN, str(script)])
    assert result.exit_code == 2


def test_a_missing_scenario_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["graph", PLAN, str(tmp_path / "no.sbs")])
    assert result.exit_code == 2


def test_writing_somewhere_impossible_is_a_clean_error(tmp_path):
    result = runner.invoke(
        app, ["graph", PLAN, SCRIPT, "--out", str(tmp_path / "no" / "g.svg")]
    )
    assert result.exit_code == 2
