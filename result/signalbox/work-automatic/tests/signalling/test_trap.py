import pytest

from signalbox.errors import InterlockingError, LayoutError, ParseError, UnknownReferenceError
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.signalling.trap import Trap, catching, traps_on
from signalbox.topology.graph import Sense
from signalbox.topology.position import Position
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance

PLAN = """
node A boundary
node P1 points
node B buffer
node C boundary
edge E1 from A to P1.toe length 600 direction down
edge E2 from P1.normal to C length 400 direction down
edge E3 from P1.reverse to B length 300 direction bidirectional
section TA over E1
section TB over E2
section TC over E3
trap TP1 on E3 at 40 facing backward
"""


@pytest.fixture
def scheme():
    return scheme_from_text(PLAN)


def test_traps_are_read_from_the_plan(scheme):
    assert sorted(scheme.traps) == ["TP1"]
    assert scheme.trap("TP1").edge == "E3"
    assert scheme.trap("TP1").position.offset.metres == 40.0


def test_a_trap_faces_the_way_the_plan_says(scheme):
    assert scheme.trap("TP1").sense is Sense.REVERSE
    assert scheme.trap("TP1").catches(Sense.REVERSE)
    assert not scheme.trap("TP1").catches(Sense.NOMINAL)


def test_a_trap_defaults_to_facing_forward():
    scheme = scheme_from_text(PLAN.replace(" facing backward", ""))
    assert scheme.trap("TP1").sense is Sense.NOMINAL


def test_an_unknown_trap_is_reported(scheme):
    with pytest.raises(InterlockingError, match="no trap called TP9"):
        scheme.trap("TP9")


def test_traps_on_an_edge_come_out_in_order(scheme):
    assert [t.name for t in traps_on(scheme.traps, "E3")] == ["TP1"]
    assert traps_on(scheme.traps, "E1") == []


def test_catching_picks_the_ones_facing_the_movement(scheme):
    assert [t.name for t in catching(scheme.traps, "E3", Sense.REVERSE)] == ["TP1"]
    assert catching(scheme.traps, "E3", Sense.NOMINAL) == []


def test_a_trap_knows_whether_it_is_between_two_offsets(scheme):
    trap = scheme.trap("TP1")
    assert trap.is_between(Distance(0.0), Distance(100.0))
    assert trap.is_between(Distance(100.0), Distance(0.0))
    assert not trap.is_between(Distance(100.0), Distance(200.0))


def test_a_trap_prints_where_it_is():
    trap = Trap("TP1", Position("E3", Distance(40.0)))
    assert str(trap) == "TP1 on E3->40m"


def test_a_trap_on_an_unknown_edge_is_refused():
    with pytest.raises(UnknownReferenceError, match="unknown edge E9"):
        validate(parse(PLAN.replace("on E3 at 40", "on E9 at 40")))


def test_a_trap_past_the_end_of_its_edge_is_refused():
    with pytest.raises(LayoutError, match="only 300.0m long"):
        validate(parse(PLAN.replace("at 40", "at 400")))


def test_a_nonsense_facing_is_refused():
    with pytest.raises(ParseError, match="use forward or backward"):
        parse("trap TP1 on E3 at 40 facing sideways\n")


def test_a_trap_cannot_take_another_names(scheme):
    from signalbox.errors import DuplicateNameError

    with pytest.raises(DuplicateNameError):
        validate(parse(PLAN + "trap TP1 on E1 at 10\n"))


def test_a_scheme_with_no_traps_has_none(kingsmoor):
    assert kingsmoor.traps == {}
