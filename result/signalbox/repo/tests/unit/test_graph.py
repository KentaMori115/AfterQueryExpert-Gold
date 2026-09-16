import pytest

from signalbox.errors import TopologyError
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.graph import Lie, Port, Sense, TrackGraph, build_graph

JUNCTION = """
node A boundary
node P105 points
node B buffer
node C boundary
edge E1 from A to P105.toe length 420 speed 75 gradient 1 in 330
edge E2 from P105.normal to C length 300 speed 75
edge E3 from P105.reverse to B length 180 speed 15
"""


@pytest.fixture
def graph() -> TrackGraph:
    scheme = parse(JUNCTION)
    validate(scheme)
    return build_graph(scheme)


def test_graph_holds_everything_declared(graph):
    assert len(graph) == 3
    assert graph.points() == ["P105"]
    assert graph.node("B").is_terminal


def test_edge_attributes_survive_the_build(graph):
    edge = graph.edge("E1")
    assert edge.length.metres == 420.0
    assert edge.speed.mph == pytest.approx(75.0)
    assert edge.gradient.one_in == 330.0


def test_edges_without_a_speed_keep_none(graph):
    scheme = parse("node A boundary\nnode B boundary\nedge E1 from A to B length 10\n")
    assert build_graph(scheme).edge("E1").speed is None


def test_sense_and_lie_have_opposites():
    assert Sense.NOMINAL.opposite is Sense.REVERSE
    assert Lie.NORMAL.opposite is Lie.REVERSE
    assert Lie.REVERSE.port == "reverse"


def test_facing_move_over_points_follows_the_lie(graph):
    assert graph.step("E1", Sense.NOMINAL, Lie.NORMAL) == [("E2", Sense.NOMINAL)]
    assert graph.step("E1", Sense.NOMINAL, Lie.REVERSE) == [("E3", Sense.NOMINAL)]


def test_trailing_move_only_works_from_the_selected_leg(graph):
    assert graph.step("E2", Sense.REVERSE, Lie.NORMAL) == [("E1", Sense.REVERSE)]
    assert graph.step("E2", Sense.REVERSE, Lie.REVERSE) == []


def test_a_boundary_leads_nowhere(graph):
    assert graph.step("E1", Sense.REVERSE) == []


def test_a_buffer_stop_leads_nowhere(graph):
    assert graph.step("E3", Sense.NOMINAL) == []


def test_crossing_joins_opposite_ends():
    scheme = parse("""
    node X crossing
    node A boundary
    node B boundary
    node C boundary
    node D boundary
    edge E1 from A to X.a1 length 10
    edge E2 from X.a2 to B length 10
    edge E3 from C to X.b1 length 10
    edge E4 from X.b2 to D length 10
    """)
    validate(scheme)
    graph = build_graph(scheme)
    assert graph.step("E1", Sense.NOMINAL) == [("E2", Sense.NOMINAL)]
    assert graph.step("E3", Sense.NOMINAL) == [("E4", Sense.NOMINAL)]


def test_plain_node_passes_straight_through():
    scheme = parse("""
    node A boundary
    node N plain
    node B boundary
    edge E1 from A to N length 10
    edge E2 from N to B length 10
    """)
    validate(scheme)
    graph = build_graph(scheme)
    assert graph.step("E1", Sense.NOMINAL) == [("E2", Sense.NOMINAL)]


def test_edge_knows_which_way_you_leave_it(graph):
    edge = graph.edge("E1")
    assert edge.sense_leaving(Port("A")) is Sense.NOMINAL
    assert edge.sense_leaving(Port("P105", "toe")) is Sense.REVERSE
    with pytest.raises(TopologyError):
        edge.sense_leaving(Port("C"))


def test_other_port_is_the_far_end(graph):
    assert graph.edge("E1").other_port(Port("A")) == Port("P105", "toe")
    with pytest.raises(TopologyError):
        graph.edge("E1").other_port(Port("Z"))


def test_unknown_names_are_reported(graph):
    with pytest.raises(TopologyError, match="no node called Z"):
        graph.node("Z")
    with pytest.raises(TopologyError, match="no edge called E9"):
        graph.edge("E9")


def test_points_missing_a_leg_are_rejected():
    scheme = parse("""
    node A boundary
    node P1 points
    node B boundary
    node C boundary
    edge E1 from A to P1.toe length 10
    edge E2 from P1.normal to B length 10
    edge E3 from C to B length 10
    """)
    with pytest.raises(TopologyError, match="missing reverse"):
        build_graph(scheme)


def test_plain_join_ends_are_given_slot_names():
    scheme = parse("""
    node A boundary
    node N plain
    node B boundary
    edge E1 from A to N length 10
    edge E2 from N to B length 10
    """)
    validate(scheme)
    graph = build_graph(scheme)
    assert graph.edge("E1").end == Port("N", "1")
    assert graph.edge("E2").start == Port("N", "2")


def test_a_plain_join_with_one_edge_is_incomplete():
    scheme = parse("node A boundary\nnode N plain\nedge E1 from A to N length 10\n")
    with pytest.raises(TopologyError, match="missing 2"):
        build_graph(scheme)


def test_direction_of_working_decides_which_senses_are_allowed(kingsmoor):
    down = kingsmoor.graph.edge("D1")
    assert down.direction == "down"
    assert down.permits(Sense.NOMINAL)
    assert not down.permits(Sense.REVERSE)
    assert not down.is_bidirectional


def test_up_edges_are_worked_in_the_reverse_sense(kingsmoor):
    up = kingsmoor.graph.edge("U1")
    assert up.permits(Sense.REVERSE)
    assert not up.permits(Sense.NOMINAL)


def test_bidirectional_edges_take_both_senses(kingsmoor):
    both = kingsmoor.graph.edge("CX")
    assert both.is_bidirectional
    assert both.permits(Sense.NOMINAL) and both.permits(Sense.REVERSE)


def test_an_edge_with_no_direction_is_worked_both_ways(graph):
    assert graph.edge("E1").is_bidirectional
