from pathlib import Path

from typer.testing import CliRunner

from cueforge.cli.main import app

ROOT = Path(__file__).resolve().parents[2]
runner = CliRunner()


def test_help_exits_zero() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "compile" in result.stdout


def test_compile_concert_text() -> None:
    result = runner.invoke(app, ["compile", str(ROOT / "examples" / "concert_two_looks.yaml")])
    assert result.exit_code == 0
    assert "concert_two_looks" in result.stdout
    assert "lx_open" in result.stdout


def test_compile_json_is_canonical() -> None:
    first = runner.invoke(
        app, ["compile", str(ROOT / "examples" / "concert_two_looks.yaml"), "--format", "json"]
    )
    second = runner.invoke(
        app, ["compile", str(ROOT / "examples" / "concert_two_looks.yaml"), "--format", "json"]
    )
    assert first.exit_code == 0
    assert first.stdout == second.stdout
    assert first.stdout.endswith("\n")
    assert '"ok":true' in first.stdout


def test_compile_cycle_exits_one() -> None:
    result = runner.invoke(
        app, ["compile", str(ROOT / "examples" / "invalid-productions" / "cycle.yaml")]
    )
    assert result.exit_code == 1
    assert "CF3002" in result.stdout


def test_bad_format_exits_two() -> None:
    result = runner.invoke(
        app, ["compile", str(ROOT / "examples" / "concert_two_looks.yaml"), "--format", "xml"]
    )
    assert result.exit_code == 2


def test_rehearse_delay_flag() -> None:
    result = runner.invoke(
        app,
        [
            "rehearse",
            str(ROOT / "examples" / "concert_two_looks.yaml"),
            "--delay",
            "lx_open=1000ms",
            "--format",
            "json",
        ],
    )
    assert result.exit_code == 0
    assert "delay:lx_open:1000" in result.stdout


def test_sheet_department() -> None:
    result = runner.invoke(
        app,
        [
            "sheet",
            str(ROOT / "examples" / "glass_harbor.yaml"),
            "--department",
            "lighting",
        ],
    )
    assert result.exit_code == 0
    assert "lx_21" in result.stdout
    assert "auto_07" not in result.stdout


def test_invalid_delay_exits_two() -> None:
    result = runner.invoke(
        app,
        ["rehearse", str(ROOT / "examples" / "concert_two_looks.yaml"), "--delay", "nope"],
    )
    assert result.exit_code == 2
