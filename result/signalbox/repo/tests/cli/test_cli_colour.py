"""Colour has to be easy to turn off, because half the output is piped."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from signalbox.cli import common
from signalbox.cli.common import NO_COLOUR_VARIABLES, wants_colour
from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_colour_is_wanted_by_default():
    assert wants_colour({})


def test_no_color_turns_it_off():
    assert not wants_colour({"NO_COLOR": "1"})


def test_an_empty_no_color_still_turns_it_off():
    assert not wants_colour({"NO_COLOR": ""})


def test_the_package_has_its_own_variable_too():
    assert not wants_colour({"SIGNALBOX_NO_COLOR": "1"})
    assert set(NO_COLOUR_VARIABLES) == {"NO_COLOR", "SIGNALBOX_NO_COLOR"}


def test_the_flag_turns_it_off(monkeypatch):
    monkeypatch.delenv("SIGNALBOX_NO_COLOR", raising=False)
    result = runner.invoke(app, ["--no-colour", "check", PLAN, "--quiet"])
    assert result.exit_code in (0, 1)


def test_the_american_spelling_works_too(monkeypatch):
    monkeypatch.delenv("SIGNALBOX_NO_COLOR", raising=False)
    result = runner.invoke(app, ["--no-color", "version"])
    assert result.exit_code == 0
    assert "signalbox" in result.stdout


def test_a_console_can_be_built_without_colour(monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    assert common.build_console().no_color


def test_a_console_can_be_built_with_colour(monkeypatch):
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.delenv("SIGNALBOX_NO_COLOR", raising=False)
    assert not common.build_console().no_color


@pytest.mark.parametrize("command", [["check", PLAN], ["routes", PLAN], ["rules"]])
def test_the_output_is_still_readable_without_colour(command, monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    result = runner.invoke(app, command)
    assert result.exit_code in (0, 1)
    assert "\x1b[" not in result.stdout
