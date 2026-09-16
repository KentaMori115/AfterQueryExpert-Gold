import pytest

from signalbox.render.geometry import (
    DEFAULT_SPACING,
    MINIMUM_RUN,
    Placement,
    Point,
    place,
)
from signalbox.topology.position import Position
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance

STRAIGHT = """
node A boundary
node N plain
node B boundary
edge E1 from A to N length 1000 direction down
edge E2 from N to B length 1000 direction down
section TA over E1
section TB over E2
"""

JUNCTION = """
node A boundary
node P1 points
node B boundary
node C boundary
edge E1 from A to P1.toe length 1000 direction down
edge E2 from P1.normal to B length 1000 direction down
edge E3 from P1.reverse to C length 800 direction down
section TA over E1
section TB over E2
section TC over E3
"""


def test_points_move_and_print():
    point = Point(10.0, 20.0)
    assert point.moved(5.0, -2.0) == Point(15.0, 18.0)
    assert str(point) == "(10.0, 20.0)"


def test_an_empty_scheme_places_nothing():
    placement = place(scheme_from_text(""))
    assert placement.is_empty
    assert placement.bounds() == (0.0, 0.0, 0.0, 0.0)
    assert placement.size() == (0.0, 0.0)


def test_a_straight_line_stays_on_one_row():
    placement = place(scheme_from_text(STRAIGHT))
    assert {point.y for point in placement.nodes.values()} == {0.0}


def test_distance_along_the_line_becomes_x():
    placement = place(scheme_from_text(STRAIGHT), scale=0.1)
    assert placement.at("A").x == 0.0
    assert placement.at("N").x == pytest.approx(100.0)
    assert placement.at("B").x == pytest.approx(200.0)


def test_a_very_short_edge_still_gets_drawn():
    placement = place(
        scheme_from_text(STRAIGHT.replace("length 1000", "length 5", 1)), scale=0.05
    )
    assert placement.at("N").x == pytest.approx(MINIMUM_RUN)


def test_the_diverging_road_drops_a_row():
    placement = place(scheme_from_text(JUNCTION))
    assert placement.at("B").y == 0.0
    assert placement.at("C").y == pytest.approx(DEFAULT_SPACING)


def test_every_edge_gets_two_ends():
    placement = place(scheme_from_text(JUNCTION))
    assert set(placement.edges) == {"E1", "E2", "E3"}
    for start, end in placement.edges.values():
        assert isinstance(start, Point) and isinstance(end, Point)


def test_bounds_cover_everything():
    placement = place(scheme_from_text(JUNCTION))
    left, top, right, bottom = placement.bounds()
    assert left == 0.0
    assert right > left
    assert bottom >= top


def test_a_position_along_an_edge_falls_between_its_ends(kingsmoor):
    placement = place(kingsmoor)
    start, end = placement.edges["D1"]
    middle = placement.along(Position("D1", Distance(280.0)), kingsmoor.graph)
    assert start.x < middle.x < end.x


def test_a_position_at_the_end_of_an_edge_is_the_end(kingsmoor):
    placement = place(kingsmoor)
    start, end = placement.edges["D1"]
    at_end = placement.along(Position("D1", Distance(560.0)), kingsmoor.graph)
    assert at_end.x == pytest.approx(end.x)
    del start


def test_an_offset_past_the_end_is_clamped(kingsmoor):
    placement = place(kingsmoor)
    _start, end = placement.edges["D1"]
    over = placement.along(Position("D1", Distance(9000.0)), kingsmoor.graph)
    assert over.x == pytest.approx(end.x)


def test_the_whole_junction_is_placed(kingsmoor):
    placement = place(kingsmoor)
    assert len(placement.nodes) == len(kingsmoor.graph.nodes)
    assert len(placement.edges) == len(kingsmoor.graph.edges)


def test_a_datum_can_be_chosen(kingsmoor):
    placement = place(kingsmoor, datum="WU")
    assert placement.at("WU") == Point(0.0, 0.0)


def test_a_placement_knows_its_own_size():
    placement = Placement(nodes={"A": Point(0.0, 0.0), "B": Point(100.0, 40.0)})
    assert placement.size() == (100.0, 40.0)
