from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_a_signal_says_what_reads_from_it():
    result = runner.invoke(app, ["where", PLAN, "K3"])
    assert result.exit_code == 0
    assert "signal K3" in result.stdout
    assert "K3(MA)" in result.stdout


def test_a_section_says_what_runs_over_it():
    result = runner.invoke(app, ["where", PLAN, "TB"])
    assert "section TB" in result.stdout
    assert "K1(M)" in result.stdout


def test_points_say_what_calls_them():
    result = runner.invoke(app, ["where", PLAN, "P101"])
    assert "points P101" in result.stdout
    assert "held for overlap by" in result.stdout


def test_an_edge_says_what_section_it_is_in():
    result = runner.invoke(app, ["where", PLAN, "D1"])
    assert "edge D1" in result.stdout
    assert "in section: TA" in result.stdout


def test_several_things_can_be_looked_up_at_once():
    result = runner.invoke(app, ["where", PLAN, "K3", "TB"])
    assert "signal K3" in result.stdout
    assert "section TB" in result.stdout


def test_an_unknown_name_is_a_clean_error():
    result = runner.invoke(app, ["where", PLAN, "wibble"])
    assert result.exit_code == 2


def test_looking_up_nothing_is_a_clean_error():
    result = runner.invoke(app, ["where", PLAN])
    assert result.exit_code == 2


def test_unused_says_everything_is_used():
    result = runner.invoke(app, ["where", PLAN, "--unused"])
    assert result.exit_code == 0
    assert "everything is used" in result.stdout


def test_unused_lists_what_is_not_used(tmp_path):
    plan = tmp_path / "spare.sbx"
    plan.write_text(
        "node A boundary\nnode P1 points\nnode B buffer\nnode C boundary\n"
        "edge E1 from A to P1.toe length 400 direction down\n"
        "edge E2 from P1.normal to C length 400 direction down\n"
        "edge E3 from P1.reverse to B length 400 direction down\n"
        "section TA over E1\nsection TB over E2\nsection TC over E3\n"
    )
    result = runner.invoke(app, ["where", str(plan), "--unused"])
    assert result.exit_code == 1
    assert "P1" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["where", str(tmp_path / "no.sbx"), "K1"]).exit_code == 2
