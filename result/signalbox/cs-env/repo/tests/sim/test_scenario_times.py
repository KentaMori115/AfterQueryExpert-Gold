"""Times that follow on from the last one, and notes in the log."""

from __future__ import annotations

import pytest

from signalbox.errors import ParseError
from signalbox.sim.scenario import parse_scenario, run_scenario

SCRIPT = """
scenario x {
    step 2
    until 100
}

at 0    train 1A05 on D1 at 60 speed 20
at +10  note the train is away
at +20  set "K1(M)"
at 90   note nearly done
"""


def test_a_relative_time_follows_the_last_one():
    scenario = parse_scenario(SCRIPT)
    assert [command.at for command in scenario.commands] == [0.0, 10.0, 30.0, 90.0]


def test_an_absolute_time_after_a_relative_one_stands_on_its_own():
    scenario = parse_scenario(SCRIPT)
    assert scenario.commands[-1].at == 90.0


def test_a_relative_time_after_an_absolute_one_follows_it():
    scenario = parse_scenario(
        "scenario x {\n step 2\n until 100\n}\n" "at 40 note first\n" "at +5 note second\n"
    )
    assert [command.at for command in scenario.commands] == [40.0, 45.0]


def test_the_first_relative_time_counts_from_nothing():
    scenario = parse_scenario("scenario x {\n step 2\n until 20\n}\nat +5 note hello\n")
    assert scenario.commands[0].at == 5.0


def test_a_note_goes_into_the_log(kingsmoor):
    result = run_scenario(kingsmoor, parse_scenario(SCRIPT))
    assert result.world.log.mentioning("the train is away")


def test_notes_are_their_own_kind_of_event(kingsmoor):
    from signalbox.sim.log import EventKind

    result = run_scenario(kingsmoor, parse_scenario(SCRIPT))
    assert result.world.log.of(EventKind.NOTE)


def test_an_empty_note_is_allowed(kingsmoor):
    scenario = parse_scenario("scenario x {\n step 2\n until 10\n}\nat 0 note\n")
    result = run_scenario(kingsmoor, scenario)
    assert result.passed
    assert result.world.log.mentioning("(nothing)")


def test_a_note_does_not_stop_the_scenario_passing(kingsmoor):
    result = run_scenario(kingsmoor, parse_scenario(SCRIPT))
    assert result.passed, result.failures


def test_a_time_that_is_not_a_number_is_refused():
    with pytest.raises(ParseError):
        parse_scenario("scenario x {\n step 2\n until 10\n}\nat soon note hello\n")
