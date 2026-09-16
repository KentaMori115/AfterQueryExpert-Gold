from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_aspects_prints_a_row_for_every_route():
    result = runner.invoke(app, ["aspects", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "K3(MA)" in result.stdout


def test_aspects_shows_the_sequence():
    result = runner.invoke(app, ["aspects", PLAN])
    assert "ahead" in result.stdout
    assert "tss, oss" in result.stdout


def test_aspects_can_be_narrowed_to_one_signal():
    result = runner.invoke(app, ["aspects", PLAN, "--signal", "K1"])
    assert "K1(M)" in result.stdout
    assert "K3(MA)" not in result.stdout


def test_a_signal_with_no_sequence_is_a_clean_error():
    result = runner.invoke(app, ["aspects", PLAN, "--signal", "K20"])
    assert result.exit_code == 2


def test_clamped_shows_only_the_read_through_problems():
    result = runner.invoke(app, ["aspects", PLAN, "--clamped"])
    assert result.exit_code == 0
    assert "K3(MA)" in result.stdout


def test_berths_lists_every_signal():
    result = runner.invoke(app, ["berths", PLAN])
    assert result.exit_code == 0
    assert "K1" in result.stdout
    assert "TA" in result.stdout


def test_berths_shows_the_protection():
    result = runner.invoke(app, ["berths", PLAN])
    assert "tss" in result.stdout


def test_steps_prints_the_describer_steps():
    result = runner.invoke(app, ["berths", PLAN, "--steps"])
    assert result.exit_code == 0
    assert "past" in result.stdout
    assert "K1" in result.stdout


def test_a_scheme_with_no_steps_says_so(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\n"
        "section TA over E1\n"
    )
    result = runner.invoke(app, ["berths", str(plain), "--steps"])
    assert "no describer steps" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["aspects", str(tmp_path / "no.sbx")]).exit_code == 2
    assert runner.invoke(app, ["berths", str(tmp_path / "no.sbx")]).exit_code == 2
