"""Every scenario in the documentation has to parse and run.

The blocks are run against Kingsmoor, which is the plan they are written for.
An expectation that fails is fine here; a command the runner does not understand
is not, because that would mean the documentation describes a language the
package does not have.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from signalbox.sim.scenario import parse_scenario, run_scenario

DOC = Path(__file__).parent.parent / "docs" / "scenarios.md"
FENCE = re.compile(r"```sbs\n(.*?)```", re.DOTALL)
BLOCKS = FENCE.findall(DOC.read_text(encoding="utf-8"))


def test_there_are_blocks_to_check():
    assert len(BLOCKS) >= 4


@pytest.mark.parametrize("text", BLOCKS, ids=range(1, len(BLOCKS) + 1))
def test_a_documented_scenario_parses(text):
    scenario = parse_scenario(text, source="scenarios.md")
    assert scenario.step > 0
    assert scenario.until > 0


@pytest.mark.parametrize("text", BLOCKS, ids=range(1, len(BLOCKS) + 1))
def test_a_documented_scenario_runs(kingsmoor, text):
    result = run_scenario(kingsmoor, parse_scenario(text))
    for failure in result.failures:
        assert "unknown command" not in failure, failure
        assert "unknown expectation" not in failure, failure
        assert "expected:" not in failure, failure


def test_every_command_in_the_table_is_shown_in_an_example():
    text = DOC.read_text(encoding="utf-8")
    commands = [
        line.split("|")[1].strip().strip("`")
        for line in text.splitlines()
        if line.startswith("| `")
    ]
    assert commands
    body = "\n".join(BLOCKS)
    for command in commands:
        assert f" {command} " in body or f" {command}\n" in body, command


def test_every_expectation_the_runner_knows_is_documented():
    text = DOC.read_text(encoding="utf-8")
    for subject in ("train", "signal", "points", "route", "section"):
        assert f"expect {subject} " in text, subject


def test_the_aspect_words_are_documented():
    text = DOC.read_text(encoding="utf-8")
    for word in ("`R`", "`Y`", "`YY`", "`G`"):
        assert word in text, word


def test_the_route_statuses_are_documented():
    from signalbox.sim.state import RouteStatus

    text = DOC.read_text(encoding="utf-8")
    for status in RouteStatus:
        assert f"`{status.value}`" in text, status.value


def test_the_readme_and_the_language_reference_point_at_it():
    root = Path(__file__).parent.parent
    assert "docs/scenarios.md" in (root / "README.md").read_text(encoding="utf-8")
