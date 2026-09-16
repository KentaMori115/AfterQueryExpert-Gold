"""The scenario parser, now that it reads one kind of line at a time."""

from __future__ import annotations

import pytest

from signalbox.errors import ParseError
from signalbox.sim.scenario import LINES, parse_scenario

HEADER = 'scenario "a name" {\n    step 2\n    until 100\n}\n'


def test_there_is_a_reader_for_every_kind_of_line():
    assert set(LINES) == {"scenario", "at", "expect"}


def test_the_header_is_read():
    scenario = parse_scenario(HEADER)
    assert scenario.name == "a name"
    assert scenario.step == 2.0
    assert scenario.until == 100.0


def test_the_header_can_be_written_on_one_line():
    scenario = parse_scenario("scenario x { step 5 until 50 }\n")
    assert scenario.step == 5.0
    assert scenario.until == 50.0


def test_a_header_with_no_braces_says_so():
    with pytest.raises(ParseError, match="needs braces"):
        parse_scenario("scenario x\n")


def test_an_unknown_setting_names_itself():
    with pytest.raises(ParseError, match="unknown scenario setting 'colour'"):
        parse_scenario("scenario x {\n colour red\n}\n")


def test_a_setting_that_is_not_a_number_names_itself():
    with pytest.raises(ParseError, match="step wants a number"):
        parse_scenario("scenario x {\n step later\n}\n")


def test_a_line_that_starts_with_punctuation_is_refused():
    with pytest.raises(ParseError, match="expected a line to start with a word"):
        parse_scenario(HEADER + "{ nonsense }\n")


def test_an_unknown_line_names_itself():
    with pytest.raises(ParseError, match="unknown line 'wibble'"):
        parse_scenario(HEADER + "wibble 3\n")


def test_a_command_keeps_every_word_after_the_verb():
    scenario = parse_scenario(HEADER + "at 0 train 1A05 on D1 at 60 length 80\n")
    assert scenario.commands[0].args == ("1A05", "on", "D1", "at", "60", "length", "80")


def test_a_command_with_no_words_after_the_verb_is_allowed():
    scenario = parse_scenario(HEADER + "at 0 note\n")
    assert scenario.commands[0].args == ()


def test_an_expectation_keeps_every_word_after_the_subject():
    scenario = parse_scenario(HEADER + "expect train 1A05 on D5\n")
    assert scenario.expectations[0].args == ("1A05", "on", "D5")


def test_a_quoted_word_keeps_its_brackets():
    scenario = parse_scenario(HEADER + 'at 0 set "K1(M)"\n')
    assert scenario.commands[0].args == ("K1(M)",)


def test_blank_lines_and_comments_are_ignored():
    scenario = parse_scenario(HEADER + "\n# a comment\n\nat 0 note hello\n")
    assert len(scenario.commands) == 1


def test_a_file_with_only_a_header_parses():
    scenario = parse_scenario(HEADER)
    assert scenario.commands == []
    assert scenario.expectations == []


def test_a_file_with_nothing_in_it_parses():
    scenario = parse_scenario("")
    assert scenario.name == "unnamed"
