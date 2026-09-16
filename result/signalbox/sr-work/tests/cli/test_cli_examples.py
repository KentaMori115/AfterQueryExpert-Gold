"""Every command has to work against every example.

A command that only works on the fixture the tests were written against is not
much use. This runs the whole command line over each example in turn, which
catches the sort of thing that only shows up on a layout with a crossover at
both ends.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
EXAMPLES = sorted((Path(__file__).parent.parent.parent / "examples").glob("*.sbx"))

READ_ONLY = (
    ["show"],
    ["show", "--detail"],
    ["signals"],
    ["routes"],
    ["table"],
    ["table", "--format", "csv"],
    ["points"],
    ["flanks"],
    ["aspects"],
    ["berths"],
    ["berths", "--steps"],
    ["locking"],
    ["headway"],
    ["chainage"],
    ["draw"],
    ["export"],
)


@pytest.fixture(params=EXAMPLES, ids=lambda path: path.stem)
def example(request):
    return str(request.param)


@pytest.mark.parametrize("command", READ_ONLY, ids=lambda c: " ".join(c))
def test_a_read_only_command_works_on_every_example(example, command):
    result = runner.invoke(app, [*command, example])
    assert result.exit_code == 0, result.stdout


def test_check_runs_on_every_example(example):
    result = runner.invoke(app, ["check", example])
    assert result.exit_code in (0, 1)
    assert "rules ran" in result.stdout


def test_pack_runs_on_every_example(example, tmp_path):
    result = runner.invoke(app, ["pack", example, "--out", str(tmp_path / "pack")])
    assert result.exit_code in (0, 1)
    assert (tmp_path / "pack" / "control.csv").exists()


def test_fmt_check_runs_on_every_example(example):
    result = runner.invoke(app, ["fmt", example, "--check"])
    assert result.exit_code in (0, 1)


def test_diff_against_itself_is_no_change(example):
    result = runner.invoke(app, ["diff", example, example])
    assert result.exit_code == 0
    assert "no change" in result.stdout
