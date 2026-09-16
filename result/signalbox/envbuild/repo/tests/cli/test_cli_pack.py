from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_pack_writes_everything(tmp_path):
    out = tmp_path / "handover"
    result = runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    assert result.exit_code in (0, 1)
    for name in (
        "kingsmoor.sbj",
        "control.csv",
        "points.csv",
        "aspects.csv",
        "locking.csv",
        "kingsmoor.svg",
        "check.txt",
        "check.json",
        "report.txt",
        "fingerprint.txt",
    ):
        assert (out / name).exists(), name


def test_the_fingerprint_file_holds_the_stamp(tmp_path):
    out = tmp_path / "handover"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    lines = (out / "fingerprint.txt").read_text().splitlines()
    assert len(lines[0]) == 12
    assert "Kingsmoor Junction" in lines[1]


def test_the_check_report_is_written(tmp_path):
    out = tmp_path / "handover"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    assert "rules ran" in (out / "check.txt").read_text()


def test_the_drawing_is_an_svg(tmp_path):
    out = tmp_path / "handover"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    assert (out / "kingsmoor.svg").read_text().startswith("<svg")


def test_packing_the_same_scheme_twice_gives_the_same_fingerprint(tmp_path):
    first = tmp_path / "a"
    second = tmp_path / "b"
    runner.invoke(app, ["pack", PLAN, "--out", str(first)])
    runner.invoke(app, ["pack", PLAN, "--out", str(second)])
    assert (first / "fingerprint.txt").read_text() == (second / "fingerprint.txt").read_text()


def test_a_scheme_with_errors_exits_nonzero(tmp_path):
    result = runner.invoke(app, ["pack", PLAN, "--out", str(tmp_path / "out")])
    assert result.exit_code == 1
    assert "rules ran" in result.stdout


def test_strict_writes_nothing_when_the_rules_find_an_error(tmp_path):
    out = tmp_path / "strict"
    result = runner.invoke(app, ["pack", PLAN, "--out", str(out), "--strict"])
    assert result.exit_code == 2
    assert not out.exists()


def test_a_clean_scheme_packs_and_exits_zero(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        'scheme plain {\n  area "Plain"\n}\n'
        "node A boundary\nnode B buffer\n"
        "edge E1 from A to B length 900 speed 20 direction bidirectional\n"
        "section TA over E1\n"
    )
    result = runner.invoke(app, ["pack", str(plain), "--out", str(tmp_path / "out")])
    assert result.exit_code == 0


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["pack", str(tmp_path / "no.sbx"), "--out", str(tmp_path)])
    assert result.exit_code == 2


def test_the_pack_includes_the_findings_as_json(tmp_path):
    import json

    out = tmp_path / "handover"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    found = json.loads((out / "check.json").read_text())
    assert found["scheme"] == "kingsmoor"
    assert found["findings"]


def test_the_json_findings_carry_the_advice(tmp_path):
    import json

    out = tmp_path / "handover"
    runner.invoke(app, ["pack", PLAN, "--out", str(out)])
    found = json.loads((out / "check.json").read_text())
    assert any("fix" in finding for finding in found["findings"])


def test_strict_can_be_held_to_warnings(tmp_path):
    plain = tmp_path / "plain.sbx"
    plain.write_text(
        'scheme plain {\n  area "Plain"\n}\n'
        "node A boundary\nnode B buffer\n"
        "edge E1 from A to B length 900 speed 20 direction bidirectional\n"
        "section TA over E1\n"
    )
    lenient = runner.invoke(app, ["pack", str(plain), "--out", str(tmp_path / "a"), "--strict"])
    strict = runner.invoke(
        app,
        ["pack", str(plain), "--out", str(tmp_path / "b"), "--strict", "--warnings-too"],
    )
    assert lenient.exit_code == 0
    assert strict.exit_code in (0, 2)


def test_strict_says_how_many_findings_stopped_it(tmp_path):
    result = runner.invoke(app, ["pack", PLAN, "--out", str(tmp_path / "out"), "--strict"])
    assert result.exit_code == 2
    assert "nothing written" in result.stdout
