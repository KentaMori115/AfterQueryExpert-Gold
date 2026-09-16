import pytest

from signalbox.errors import DuplicateNameError, LayoutError, ParseError, UnknownReferenceError
from signalbox.layout.ast import CrossingKind
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate

PLAN = """
node A boundary
node B boundary
edge E1 from A to B length 800 direction down
section TA over E1
crossing LC21 on E1 at 300 type mcb strike_in 27
crossing LC23 on E1 at 600 type ahb
"""


def test_crossings_are_read_with_their_kind():
    scheme = parse(PLAN)
    assert [c.name for c in scheme.crossings] == ["LC21", "LC23"]
    assert scheme.crossing("LC21").kind is CrossingKind.MANUAL_BARRIER
    assert scheme.crossing("LC23").kind is CrossingKind.AUTOMATIC_HALF


def test_a_crossing_defaults_to_a_manual_barrier():
    scheme = parse("edge E1 from A to B length 100\ncrossing LC1 on E1 at 10\n")
    assert scheme.crossing("LC1").kind is CrossingKind.MANUAL_BARRIER


def test_extra_settings_are_kept():
    assert parse(PLAN).crossing("LC21").attributes["strike_in"] == "27"


def test_an_unknown_crossing_is_none():
    assert parse(PLAN).crossing("LC99") is None


def test_only_protected_kinds_are_proved():
    assert CrossingKind.MANUAL_BARRIER.is_protected
    assert CrossingKind.OBSTACLE_DETECTED.is_protected
    assert not CrossingKind.AUTOMATIC_HALF.is_protected
    assert not CrossingKind.OPEN.is_protected


def test_kinds_are_looked_up_by_word():
    assert CrossingKind.from_word("uwc") is CrossingKind.USER_WORKED
    assert CrossingKind.from_word("gates") is None


def test_a_nonsense_kind_is_refused():
    with pytest.raises(ParseError, match="not a kind of level crossing"):
        parse("crossing LC1 on E1 at 10 type gates\n")


def test_a_crossing_on_an_unknown_edge_is_refused():
    with pytest.raises(UnknownReferenceError, match="unknown edge E9"):
        validate(parse(PLAN.replace("on E1 at 300", "on E9 at 300")))


def test_a_crossing_past_the_end_of_its_edge_is_refused():
    with pytest.raises(LayoutError, match="only 800.0m long"):
        validate(parse(PLAN.replace("at 300", "at 900")))


def test_two_crossings_cannot_share_a_name():
    with pytest.raises(DuplicateNameError):
        validate(parse(PLAN + "crossing LC21 on E1 at 700\n"))


def test_a_crossing_cannot_take_a_signals_name():
    with pytest.raises(DuplicateNameError):
        validate(parse(PLAN + "signal LC21 on E1 at 100 facing forward\n"))


def test_a_sound_plan_with_crossings_validates():
    validate(parse(PLAN))
