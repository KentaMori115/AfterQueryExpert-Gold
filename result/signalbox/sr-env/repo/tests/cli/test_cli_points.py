from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_points_lists_every_set():
    result = runner.invoke(app, ["points", PLAN])
    assert result.exit_code == 0
    for name in ("P101", "P102", "P103", "P104", "P105"):
        assert name in result.stdout


def test_points_shows_which_routes_call_them():
    result = runner.invoke(app, ["points", PLAN])
    assert "K3(MA)" in result.stdout


def test_facing_narrows_the_list():
    result = runner.invoke(app, ["points", PLAN, "--facing"])
    assert "P101" in result.stdout
    assert "P102" not in result.stdout


def test_a_scheme_with_no_points_says_so(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\n"
        "section TA over E1\n"
    )
    result = runner.invoke(app, ["points", str(plain)])
    assert "no points in this scheme" in result.stdout


def test_flanks_lists_them_with_what_holds_them():
    result = runner.invoke(app, ["flanks", PLAN])
    assert result.exit_code == 0
    assert "P103.reverse" in result.stdout
    assert "P104 normal" in result.stdout


def test_open_shows_only_the_unprotected_ones():
    result = runner.invoke(app, ["flanks", PLAN, "--open"])
    assert "unprotected" in result.stdout
    assert "at danger" not in result.stdout


def test_a_scheme_with_no_flanks_says_so(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\n"
        "section TA over E1\n"
        "signal S1 on E1 at 100 facing forward direction down\n"
    )
    result = runner.invoke(app, ["flanks", str(plain)])
    assert "nothing to report" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["points", str(tmp_path / "no.sbx")]).exit_code == 2
    assert runner.invoke(app, ["flanks", str(tmp_path / "no.sbx")]).exit_code == 2
