import pytest

from signalbox.errors import DuplicateNameError, LayoutError, UnknownReferenceError
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate

GOOD = """
node A boundary
node P105 points
node B buffer
node C boundary
edge E1 from A to P105.toe length 420
edge E2 from P105.normal to C length 300
edge E3 from P105.reverse to B length 180
section TA over E1
signal K12 on E1 at 380 facing forward
"""


def check(text):
    validate(parse(text))


def test_a_sound_plan_passes():
    check(GOOD)


def test_duplicate_names_across_kinds_are_caught():
    with pytest.raises(DuplicateNameError, match="already declared"):
        check(GOOD + "section E1 over E2\n")


def test_edge_to_unknown_node():
    with pytest.raises(UnknownReferenceError, match="unknown node Z"):
        check("node A boundary\nedge E1 from A to Z length 10\n")


def test_points_must_name_a_port():
    with pytest.raises(UnknownReferenceError, match="must say which end"):
        check("node A boundary\nnode P1 points\nedge E1 from A to P1 length 10\n")


def test_points_port_must_exist():
    with pytest.raises(UnknownReferenceError, match="no port 'middle'"):
        check("node A boundary\nnode P1 points\nedge E1 from A to P1.middle length 10\n")


def test_plain_node_takes_no_port():
    with pytest.raises(UnknownReferenceError, match="has no port"):
        check("node A boundary\nnode N plain\nedge E1 from A to N.toe length 10\n")


def test_two_edges_cannot_share_one_end():
    text = """
    node A boundary
    node B boundary
    node C boundary
    edge E1 from A to B length 10
    edge E2 from A to C length 10
    """
    with pytest.raises(LayoutError, match="already has edge E1"):
        check(text)


def test_a_buffer_stop_needs_exactly_one_edge():
    with pytest.raises(LayoutError, match="buffer B has 0 edges"):
        check("node B buffer\n")


def test_points_need_three_edges():
    with pytest.raises(LayoutError, match="points P1 has 1 edges"):
        check("node A boundary\nnode P1 points\nedge E1 from A to P1.toe length 10\n")


def test_zero_length_edge_is_refused():
    with pytest.raises(LayoutError, match="length of 0"):
        check("node A boundary\nnode B boundary\nedge E1 from A to B length 0\n")


def test_section_over_unknown_edge():
    with pytest.raises(UnknownReferenceError, match="unknown edge E9"):
        check(GOOD + "section TZ over E9\n")


def test_an_edge_belongs_to_one_section_only():
    with pytest.raises(LayoutError, match="already in section TA"):
        check(GOOD + "section TB over E1\n")


def test_signal_must_stand_on_a_real_edge():
    with pytest.raises(UnknownReferenceError, match="unknown edge E9"):
        check(GOOD.replace("signal K12 on E1", "signal K12 on E9"))


def test_signal_cannot_stand_past_the_end_of_its_edge():
    with pytest.raises(LayoutError, match="only 420.0m long"):
        check(GOOD.replace("at 380", "at 800"))


def test_five_aspect_signals_do_not_exist_here():
    with pytest.raises(LayoutError, match="expected 2, 3 or 4"):
        check(GOOD.replace("facing forward", "facing forward aspects 5"))


def test_a_plain_join_takes_two_edges():
    check("""
    node A boundary
    node N plain
    node B boundary
    edge E1 from A to N length 10
    edge E2 from N to B length 10
    """)


def test_a_plain_join_will_not_take_three():
    with pytest.raises(LayoutError, match="already has edge E1"):
        check("""
        node A boundary
        node N plain
        node B boundary
        node C boundary
        edge E1 from A to N length 10
        edge E2 from N to B length 10
        edge E3 from N to C length 10
        """)


def test_a_signal_may_not_face_against_a_one_way_track():
    with pytest.raises(LayoutError, match="is down only"):
        check("""
        node A boundary
        node B boundary
        edge E1 from A to B length 100 direction down
        signal S1 on E1 at 10 facing backward direction up
        """)


def test_a_bidirectional_track_takes_signals_both_ways():
    check("""
    node A boundary
    node B boundary
    edge E1 from A to B length 100 direction bidirectional
    signal S1 on E1 at 10 facing backward direction up
    signal S2 on E1 at 90 facing forward direction down
    """)
