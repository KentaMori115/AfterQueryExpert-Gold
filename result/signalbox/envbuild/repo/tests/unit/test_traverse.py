import pytest

from signalbox.topology.graph import Lie, Sense
from signalbox.topology.position import Position
from signalbox.topology.traverse import (
    Step,
    against_the_flow,
    both_ways,
    entry_position,
    walk,
    worked_in,
)
from signalbox.units import Distance


def steps(kingsmoor, start, **kwargs):
    kwargs.setdefault("limit", Distance(5000.0))
    return list(walk(kingsmoor.graph, start, **kwargs))


def test_the_first_step_is_where_you_started(kingsmoor):
    found = steps(kingsmoor, Position("D1", Distance(100.0)))
    assert found[0].edge == "D1"
    assert found[0].travelled.metres == 0.0


def test_the_walk_carries_on_edge_by_edge(kingsmoor):
    found = steps(kingsmoor, Position("D1", Distance(0.0)))
    assert [step.edge for step in found][:3] == ["D1", "D2", "D3"]


def test_distance_is_measured_from_the_start(kingsmoor):
    found = steps(kingsmoor, Position("D1", Distance(60.0)))
    assert found[1].travelled.metres == pytest.approx(500.0)


def test_the_limit_ends_the_walk(kingsmoor):
    found = steps(kingsmoor, Position("D1", Distance(0.0)), limit=Distance(10.0))
    assert [step.edge for step in found] == ["D1"]


def test_the_points_decide_which_way_it_goes(kingsmoor):
    normal = steps(kingsmoor, Position("D4", Distance(0.0)))
    reverse = steps(kingsmoor, Position("D4", Distance(0.0)), lies={"P101": Lie.REVERSE})
    assert normal[1].edge == "D5"
    assert reverse[1].edge == "D7"


def test_the_walk_stops_at_a_boundary(kingsmoor):
    found = steps(kingsmoor, Position("D5", Distance(0.0)))
    assert found[-1].edge == "D6"


def test_the_walk_does_not_go_round_a_loop(kingsmoor):
    found = steps(kingsmoor, Position("D1", Distance(0.0)))
    assert len({step.edge for step in found}) == len(found)


def test_allow_can_stop_the_walk(kingsmoor):
    found = steps(
        kingsmoor,
        Position("D1", Distance(0.0)),
        allow=lambda edge, sense: edge != "D3",
    )
    assert [step.edge for step in found] == ["D1", "D2"]


def test_worked_in_keeps_to_the_direction_of_working(kingsmoor):
    allow = worked_in(kingsmoor.graph)
    assert allow("D1", Sense.NOMINAL)
    assert not allow("D1", Sense.REVERSE)


def test_against_the_flow_is_for_walking_backwards(kingsmoor):
    allow = against_the_flow(kingsmoor.graph)
    assert allow("D1", Sense.REVERSE)
    assert not allow("D1", Sense.NOMINAL)


def test_entry_position_is_the_end_you_come_in_by(kingsmoor):
    assert entry_position(kingsmoor.graph, "D1", Sense.NOMINAL).offset.metres == 0.0
    assert entry_position(kingsmoor.graph, "D1", Sense.REVERSE).offset.metres == 560.0


def test_both_ways_gives_every_leg_of_the_points(kingsmoor):
    found = both_ways(kingsmoor.graph, "D4", Sense.NOMINAL)
    assert {edge for edge, _ in found} == {"D5", "D7"}


def test_both_ways_from_plain_track_gives_one(kingsmoor):
    assert len(both_ways(kingsmoor.graph, "D1", Sense.NOMINAL)) == 1


def test_steps_print_where_and_how_far():
    step = Step(Position("D1", Distance(0.0)), Distance(420.0))
    assert str(step) == "D1->0m after 420m"
