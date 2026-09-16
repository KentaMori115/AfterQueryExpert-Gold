import subprocess
import sys

from typer.testing import CliRunner

from signalbox import __version__
from signalbox.cli.main import app

runner = CliRunner()


def test_the_version_flag_prints_the_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_the_short_version_flag_works_too():
    result = runner.invoke(app, ["-V"])
    assert result.exit_code == 0
    assert "signalbox" in result.stdout


def test_the_version_command_still_works():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_no_arguments_prints_the_help():
    result = runner.invoke(app, [])
    assert "Interlocking design and verification" in result.stdout


def test_the_help_lists_the_commands():
    result = runner.invoke(app, ["--help"])
    for command in ("check", "routes", "table", "draw", "sim", "pack"):
        assert command in result.stdout


def test_an_unknown_command_is_refused():
    result = runner.invoke(app, ["wibble"])
    assert result.exit_code != 0


def test_the_package_can_be_run_as_a_module():
    result = subprocess.run(
        [sys.executable, "-m", "signalbox", "--version"],
        capture_output=True,
        text=True,
        cwd="src",
    )
    assert result.returncode == 0
    assert "signalbox" in result.stdout


def test_the_help_says_what_the_file_types_are():
    result = runner.invoke(app, ["--help"])
    assert ".sbx" in result.stdout
    assert ".sbs" in result.stdout
    assert ".sbj" in result.stdout


def test_every_command_in_the_readme_exists():
    from pathlib import Path

    readme = (Path(__file__).parent.parent.parent / "README.md").read_text()
    mentioned = {
        line.split()[1]
        for line in readme.splitlines()
        if line.startswith("signalbox ") and len(line.split()) > 1
    }
    listed = runner.invoke(app, ["--help"]).stdout
    for command in sorted(mentioned):
        assert command in listed, command


def test_the_help_for_every_command_works():
    for command in ("check", "routes", "table", "draw", "sim", "graph", "pack", "fmt"):
        result = runner.invoke(app, [command, "--help"])
        assert result.exit_code == 0, command
