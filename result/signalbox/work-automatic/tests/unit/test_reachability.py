from signalbox.topology.graph import Sense
from signalbox.topology.reachability import (
    dead_ends,
    reachable,
    unreachable_edges,
    unreachable_sections,
)
from signalbox.topology.scheme import scheme_from_text

ISLAND = """
node A boundary
node B boundary
node C buffer
node D buffer
edge E1 from A to B length 400 direction bidirectional
edge E2 from C to D length 400 direction bidirectional
section TA over E1
section TB over E2
"""

ONE_WAY = """
node A boundary
node J plain
node B buffer
edge E1 from A to J length 400 direction down
edge E2 from J to B length 400 direction up
section TA over E1
section TB over E2
"""


def test_everything_at_kingsmoor_is_reachable(kingsmoor):
    assert unreachable_edges(kingsmoor) == []
    assert unreachable_sections(kingsmoor) == []


def test_the_reach_records_which_way_it_got_there(kingsmoor):
    reach = reachable(kingsmoor)
    assert reach.reached("D1", Sense.NOMINAL)
    assert not reach.reached("D1", Sense.REVERSE)
    assert "D1" in reach


def test_an_island_of_track_is_unreachable():
    scheme = scheme_from_text(ISLAND)
    assert unreachable_edges(scheme) == ["E2"]
    assert unreachable_sections(scheme) == ["TB"]


def test_direction_of_working_can_strand_track():
    scheme = scheme_from_text(ONE_WAY)
    assert unreachable_edges(scheme) == ["E2"]


def test_ignoring_direction_reaches_more():
    scheme = scheme_from_text(ONE_WAY)
    assert unreachable_edges(scheme, respect_direction=False) == []


def test_the_reach_has_a_size(kingsmoor):
    assert len(reachable(kingsmoor)) == len(kingsmoor.graph.edges)


def test_the_kingsmoor_bay_can_be_left_again(kingsmoor):
    assert dead_ends(kingsmoor) == []


def test_a_bidirectional_siding_is_not_a_dead_end():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B boundary
    node S buffer
    edge E1 from A to P1.toe length 400 direction bidirectional
    edge E2 from P1.normal to B length 400 direction bidirectional
    edge E3 from P1.reverse to S length 200 direction bidirectional
    section TA over E1
    section TB over E2
    section TC over E3
    """)
    assert dead_ends(scheme) == []


def test_a_one_way_siding_is_a_dead_end():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B boundary
    node S buffer
    edge E1 from A to P1.toe length 400 direction down
    edge E2 from P1.normal to B length 400 direction down
    edge E3 from P1.reverse to S length 200 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    """)
    assert dead_ends(scheme) == ["E3"]
