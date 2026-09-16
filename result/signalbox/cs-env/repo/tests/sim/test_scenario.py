import pytest

from signalbox.errors import ParseError
from signalbox.sim.scenario import (
    Command,
    Expectation,
    Scenario,
    parse_scenario,
    run_scenario,
)

SCRIPT = """
scenario "a name" {
    step 2
    until 100
}

at 0 train 1A05 on D1 at 100 length 80 speed 20
at 10 set "K1(M)"
at 90 cancel "K1(M)"

expect train 1A05 on D2
expect signal K1 shows R
expect section TA clear
"""


def test_the_header_is_read():
    scenario = parse_scenario(SCRIPT)
    assert scenario.name == "a name"
    assert scenario.step == 2.0
    assert scenario.until == 100.0


def test_commands_keep_their_time_and_arguments():
    scenario = parse_scenario(SCRIPT)
    assert [c.at for c in scenario.commands] == [0.0, 10.0, 90.0]
    assert scenario.commands[1].verb == "set"
    assert scenario.commands[1].args == ("K1(M)",)


def test_expectations_are_read():
    scenario = parse_scenario(SCRIPT)
    assert [e.subject for e in scenario.expectations] == ["train", "signal", "section"]
    assert str(scenario.expectations[1]) == "expect signal K1 shows R"


def test_commands_can_be_asked_for_by_time_window():
    scenario = parse_scenario(SCRIPT)
    assert [c.verb for c in scenario.due(0.0, 20.0)] == ["train", "set"]
    assert scenario.due(200.0, 300.0) == []


def test_commands_print_readably():
    assert str(Command(10.0, "set", ("K1(M)",))) == "at 10 set K1(M)"


def test_an_unknown_setting_is_refused():
    with pytest.raises(ParseError, match="unknown scenario setting"):
        parse_scenario("scenario x {\n  colour red\n}\n")


def test_an_unknown_line_is_refused():
    with pytest.raises(ParseError, match="unknown line 'wibble'"):
        parse_scenario("wibble 3\n")


def test_a_scenario_block_needs_braces():
    with pytest.raises(ParseError, match="needs braces"):
        parse_scenario("scenario x\n")


def test_a_train_runs_where_the_routes_take_it(kingsmoor):
    scenario = parse_scenario(
        "scenario x {\n step 2\n until 300\n}\n"
        "at 0 train 1A05 on D1 at 60 length 80 speed 20\n"
        'at 4 set "K1(M)"\n'
        'at 8 set "K3(MB)"\n'
        "expect train 1A05 on D7\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert result.passed, result.failures
    assert result.summary() == "x: passed"


def test_an_expectation_that_fails_is_reported(kingsmoor):
    scenario = parse_scenario(
        "scenario x {\n step 5\n until 20\n}\n"
        "at 0 train 1A05 on D1 at 60\n"
        "expect train 1A05 on D5\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert not result.passed
    assert "expected D5" in result.failures[0]
    assert result.summary() == "x: 1 failed"


def test_a_route_that_cannot_be_set_is_reported(kingsmoor):
    scenario = parse_scenario('scenario x {\n step 5\n until 10\n}\nat 0 set "K9(M)"\n')
    result = run_scenario(kingsmoor, scenario)
    assert "could not set K9(M)" in result.failures[0]


def test_an_unknown_command_is_reported(kingsmoor):
    scenario = parse_scenario("scenario x {\n step 5\n until 10\n}\nat 0 fly 1A05\n")
    result = run_scenario(kingsmoor, scenario)
    assert "unknown command 'fly'" in result.failures[0]


def test_a_malformed_train_line_is_reported(kingsmoor):
    scenario = parse_scenario("scenario x {\n step 5\n until 10\n}\nat 0 train 1A05 D1\n")
    result = run_scenario(kingsmoor, scenario)
    assert "expected: train NAME on EDGE at OFFSET" in result.failures[0]


def test_an_unknown_expectation_is_reported(kingsmoor):
    scenario = parse_scenario("scenario x {\n step 5\n until 10\n}\nexpect weather sunny\n")
    result = run_scenario(kingsmoor, scenario)
    assert "unknown expectation 'weather'" in result.failures[0]


def test_a_bad_aspect_word_is_reported(kingsmoor):
    scenario = parse_scenario(
        "scenario x {\n step 5\n until 10\n}\nexpect signal K1 shows purple\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert "not an aspect" in result.failures[0]


def test_a_train_can_be_taken_off_again(kingsmoor):
    scenario = parse_scenario(
        "scenario x {\n step 5\n until 30\n}\n"
        "at 0 train 1A05 on D1 at 60\n"
        "at 10 remove 1A05\n"
        "expect section TA clear\n"
    )
    assert run_scenario(kingsmoor, scenario).passed


def test_the_scenario_file_beside_the_plan_passes(kingsmoor):
    from pathlib import Path

    text = (Path(__file__).parent.parent / "data" / "down-through-the-junction.sbs").read_text()
    result = run_scenario(kingsmoor, parse_scenario(text))
    assert result.passed, result.failures


def test_a_default_scenario_has_sensible_settings():
    scenario = Scenario()
    assert scenario.step == 1.0
    assert scenario.until == 300.0
    assert scenario.commands == []
    assert str(Expectation("train", ("1A05", "on", "D1"))) == "expect train 1A05 on D1"


def test_a_setting_that_is_not_a_number_is_refused():
    with pytest.raises(ParseError, match="wants a number"):
        parse_scenario("scenario x {\n  step later\n}\n")


def test_a_train_can_be_faced_backwards(kingsmoor):
    from signalbox.topology.graph import Sense

    scenario = parse_scenario(
        "scenario x {\n step 2\n until 10\n}\nat 0 train 2B10 on U8 at 40 facing backward\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert result.world.train("2B10").front.sense is Sense.REVERSE


def test_a_train_faces_forward_by_default(kingsmoor):
    from signalbox.topology.graph import Sense

    scenario = parse_scenario(
        "scenario x {\n step 2\n until 10\n}\nat 0 train 1A05 on D1 at 60\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert result.world.train("1A05").front.sense is Sense.NOMINAL


def test_a_nonsense_facing_is_reported(kingsmoor):
    scenario = parse_scenario(
        "scenario x {\n step 2\n until 10\n}\nat 0 train 1A05 on D1 at 60 facing sideways\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert "not a facing" in result.failures[0]
