import pytest

from signalbox.errors import TopologyError
from signalbox.sim.train import DEFAULT_LENGTH, Train
from signalbox.topology.graph import Sense
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


def train_on(edge, offset, **kwargs):
    return Train("1A05", Position(edge, Distance(offset)), **kwargs)


def test_a_train_starts_at_a_stand():
    train = train_on("D1", 100.0)
    assert not train.moving
    assert train.length == DEFAULT_LENGTH


def test_the_rear_is_a_train_length_behind_the_front(kingsmoor):
    train = train_on("D1", 300.0, length=Distance(80.0))
    assert train.rear(kingsmoor.graph).offset.metres == pytest.approx(220.0)


def test_the_rear_of_a_train_hanging_off_the_end_is_the_front(kingsmoor):
    train = train_on("D1", 20.0, length=Distance(80.0))
    assert train.rear(kingsmoor.graph).offset.metres == pytest.approx(20.0)


def test_a_short_train_stands_on_one_edge(kingsmoor):
    train = train_on("D1", 300.0, length=Distance(80.0))
    assert train.edges_under(kingsmoor.graph) == ["D1"]
    assert train.sections_under(kingsmoor) == ["TA"]


def test_a_train_over_a_joint_occupies_two_sections(kingsmoor):
    train = train_on("D2", 20.0, length=Distance(80.0))
    assert train.sections_under(kingsmoor) == ["TB", "TA"]


def test_a_long_train_can_cover_three_sections(kingsmoor):
    train = train_on("D3", 20.0, length=Distance(200.0))
    assert train.sections_under(kingsmoor) == ["TC", "TB", "TA"]


def test_moving_the_train_moves_its_front(kingsmoor):
    train = train_on("D1", 100.0)
    assert train.move(kingsmoor.graph, Distance(200.0))
    assert train.front.offset.metres == pytest.approx(300.0)


def test_moving_over_a_node_carries_on_to_the_next_edge(kingsmoor):
    train = train_on("D1", 500.0)
    assert train.move(kingsmoor.graph, Distance(100.0))
    assert train.front.edge == "D2"


def test_running_out_of_track_stops_the_train(kingsmoor):
    train = train_on("D6", 40.0, speed=Speed.from_mph(30))
    assert not train.move(kingsmoor.graph, Distance(200.0))
    assert not train.moving


def test_a_train_cannot_be_moved_backwards(kingsmoor):
    with pytest.raises(TopologyError, match="turn it round"):
        train_on("D1", 100.0).move(kingsmoor.graph, Distance(-10.0))


def test_accelerating_towards_a_higher_speed():
    train = train_on("D1", 100.0)
    train.accelerate(Speed.from_mph(60), seconds=10.0, rate=0.5)
    assert train.speed.mps == pytest.approx(5.0)


def test_accelerating_does_not_overshoot():
    train = train_on("D1", 100.0)
    train.accelerate(Speed.from_mph(1), seconds=100.0)
    assert train.speed.mps == pytest.approx(Speed.from_mph(1).mps)


def test_braking_towards_a_lower_speed():
    train = train_on("D1", 100.0, speed=Speed.from_mph(60))
    train.accelerate(Speed(0.0), seconds=10.0, rate=0.5)
    assert train.speed.mps == pytest.approx(Speed.from_mph(60).mps - 5.0)


def test_braking_stops_at_a_stand():
    train = train_on("D1", 100.0, speed=Speed.from_mph(60))
    train.accelerate(Speed(0.0), seconds=1000.0)
    assert train.speed.mps == 0.0


def test_stopping_records_where():
    train = train_on("D1", 100.0, speed=Speed.from_mph(60))
    train.stop(at="K1")
    assert not train.moving
    assert train.stopped_at == "K1"


def test_turning_a_train_round_faces_it_the_other_way(kingsmoor):
    train = train_on("D1", 300.0)
    turned = train.turned_round()
    assert turned.front.sense is Sense.REVERSE
    assert turned.front.offset.metres == pytest.approx(300.0)


def test_a_train_prints_where_it_is_and_how_fast():
    train = train_on("D1", 300.0, speed=Speed.from_mph(45))
    assert str(train) == "1A05 at D1->300m doing 45 mph"


def test_a_train_uses_the_same_definition_of_moving_as_the_speed():
    train = train_on("D1", 100.0, speed=Speed(0.005))
    assert not train.moving
    assert train.speed.stopped


def test_a_train_creeping_faster_than_the_threshold_is_moving():
    assert train_on("D1", 100.0, speed=Speed(0.5)).moving
