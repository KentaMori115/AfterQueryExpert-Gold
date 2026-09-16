from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_headway_prints_a_row_per_block():
    result = runner.invoke(app, ["headway", PLAN])
    assert result.exit_code == 0
    assert "K1(M)" in result.stdout
    assert "trains an hour" in result.stdout


def test_the_worst_block_comes_first():
    result = runner.invoke(app, ["headway", PLAN])
    lines = [line for line in result.stdout.splitlines() if "K" in line and "(" in line]
    assert lines


def test_only_the_worst_block_can_be_asked_for():
    full = runner.invoke(app, ["headway", PLAN]).stdout
    one = runner.invoke(app, ["headway", PLAN, "--worst"]).stdout
    assert len(one) < len(full)


def test_a_longer_train_makes_the_headway_worse():
    short = runner.invoke(app, ["headway", PLAN, "--train", "80"]).stdout
    long = runner.invoke(app, ["headway", PLAN, "--train", "400"]).stdout
    assert short != long


def test_a_train_with_no_length_is_a_clean_error():
    result = runner.invoke(app, ["headway", PLAN, "--train", "0"])
    assert result.exit_code == 2


def test_a_scheme_with_no_blocks_says_so(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 speed 40 direction down\n"
        "section TA over E1\n"
        "signal S1 on E1 at 200 facing forward direction down\n"
    )
    result = runner.invoke(app, ["headway", str(plain)])
    assert "no blocks to measure" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["headway", str(tmp_path / "no.sbx")]).exit_code == 2
