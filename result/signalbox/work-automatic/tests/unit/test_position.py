import pytest

from signalbox.errors import TopologyError
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.graph import Lie, Sense, build_graph
from signalbox.topology.position import Position, advance, distance_between
from signalbox.units import Distance

PLAN = """
node A boundary
node P1 points
node B buffer
node C boundary
edge E1 from A to P1.toe length 400
edge E2 from P1.normal to C length 300
edge E3 from P1.reverse to B length 100
"""


@pytest.fixture
def graph():
    scheme = parse(PLAN)
    validate(scheme)
    return build_graph(scheme)


def test_remaining_depends_on_sense(graph):
    here = Position("E1", Distance(150.0), Sense.NOMINAL)
    assert here.remaining(graph).metres == pytest.approx(250.0)
    assert here.behind(graph).metres == pytest.approx(150.0)
    assert here.reversed.remaining(graph).metres == pytest.approx(150.0)


def test_advance_within_one_edge(graph):
    here = Position.at_start("E1")
    moved = advance(graph, here, Distance(120.0))
    assert moved.edge == "E1"
    assert moved.offset.metres == pytest.approx(120.0)


def test_advance_backwards_along_an_edge(graph):
    here = Position("E1", Distance(300.0), Sense.REVERSE)
    moved = advance(graph, here, Distance(100.0))
    assert moved.offset.metres == pytest.approx(200.0)


def test_advance_crosses_points_the_way_they_lie(graph):
    here = Position.at_start("E1")
    normal = advance(graph, here, Distance(500.0))
    assert normal.edge == "E2" and normal.offset.metres == pytest.approx(100.0)
    reverse = advance(graph, here, Distance(450.0), {"P1": Lie.REVERSE})
    assert reverse.edge == "E3" and reverse.offset.metres == pytest.approx(50.0)


def test_advance_stops_at_a_buffer(graph):
    here = Position.at_start("E1")
    assert advance(graph, here, Distance(600.0), {"P1": Lie.REVERSE}) is None


def test_advance_stops_at_the_scheme_boundary(graph):
    here = Position("E1", Distance(400.0), Sense.REVERSE)
    assert advance(graph, here, Distance(401.0)) is None


def test_advance_refuses_a_negative_distance(graph):
    with pytest.raises(TopologyError):
        advance(graph, Position.at_start("E1"), Distance(-1.0))


def test_distance_between_on_the_same_edge(graph):
    a = Position("E1", Distance(50.0))
    b = Position("E1", Distance(310.0))
    assert distance_between(graph, a, b).metres == pytest.approx(260.0)


def test_distance_between_is_directional(graph):
    a = Position("E1", Distance(310.0))
    b = Position("E1", Distance(50.0))
    assert distance_between(graph, a, b) is None
    assert distance_between(graph, a.reversed, b).metres == pytest.approx(260.0)


def test_distance_between_across_points(graph):
    a = Position("E1", Distance(100.0))
    b = Position("E2", Distance(200.0))
    assert distance_between(graph, a, b).metres == pytest.approx(500.0)
    assert distance_between(graph, a, b, {"P1": Lie.REVERSE}) is None


def test_distance_between_honours_the_limit(graph):
    a = Position("E1", Distance(100.0))
    b = Position("E2", Distance(200.0))
    assert distance_between(graph, a, b, limit=Distance(400.0)) is None


def test_position_prints_readably():
    assert str(Position("E1", Distance(120.0))) == "E1->120m"
    assert str(Position("E1", Distance(120.0), Sense.REVERSE)) == "E1<-120m"
