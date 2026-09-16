"""The scenario language, checked against its own tables of verbs and subjects.

Both used to be long if chains, and the tables are only an improvement if they
stay complete: every verb the documentation lists has a handler, every handler
complains rather than raising when it is given the wrong words, and nothing is
in one table and not the other.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.sim.scenario import CHECKS, COMMANDS, parse_scenario, run_scenario

DOC = Path(__file__).parent.parent.parent / "docs" / "scenarios.md"


def script(body, until=20, step=2):
    return parse_scenario(f"scenario x {{\n step {step}\n until {until}\n}}\n" + body)


def test_every_documented_verb_has_a_handler():
    text = DOC.read_text(encoding="utf-8")
    listed = {
        line.split("|")[1].strip().strip("`")
        for line in text.splitlines()
        if line.startswith("| `")
    }
    assert listed
    assert listed <= set(COMMANDS), listed - set(COMMANDS)


def test_every_handler_is_documented():
    text = DOC.read_text(encoding="utf-8")
    for verb in COMMANDS:
        assert f"`{verb}`" in text, verb


def test_every_expectation_subject_is_documented():
    text = DOC.read_text(encoding="utf-8")
    for subject in CHECKS:
        assert f"expect {subject} " in text, subject


@pytest.mark.parametrize("verb", sorted(COMMANDS))
def test_a_verb_given_no_words_complains_rather_than_raising(kingsmoor, verb):
    result = run_scenario(kingsmoor, script(f"at 0 {verb}\n"))
    assert all("Traceback" not in failure for failure in result.failures)


@pytest.mark.parametrize("subject", sorted(CHECKS))
def test_an_expectation_given_no_words_complains(kingsmoor, subject):
    result = run_scenario(kingsmoor, script(f"expect {subject}\n"))
    assert result.failures
    assert "expected:" in result.failures[0]


@pytest.mark.parametrize("subject", sorted(CHECKS))
def test_an_expectation_nobody_knows_how_to_make_is_named(kingsmoor, subject):
    name = {
        "train": "1A05",
        "signal": "K1",
        "points": "P101",
        "route": '"K1(M)"',
        "section": "TA",
    }[subject]
    setup = "at 0 train 1A05 on D1 at 60\n" if subject == "train" else ""
    result = run_scenario(kingsmoor, script(f"{setup}expect {subject} {name} wibble x\n"))
    assert "do not know how to check" in result.failures[0]


def test_an_unknown_verb_is_named(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 wibble\n"))
    assert "unknown command 'wibble'" in result.failures[0]


def test_an_unknown_expectation_is_named(kingsmoor):
    result = run_scenario(kingsmoor, script("expect weather sunny\n"))
    assert "unknown expectation 'weather'" in result.failures[0]


def test_a_train_is_both_something_to_do_and_something_to_expect():
    # The only name in both tables, and it means different things in each.
    assert set(COMMANDS) & set(CHECKS) == {"train"}
