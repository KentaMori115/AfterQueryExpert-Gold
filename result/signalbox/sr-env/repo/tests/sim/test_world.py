import pytest

from signalbox.signalling.signal import Aspect
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    return build_world(kingsmoor)


def down_train(world, offset=100.0, **kwargs):
    return world.add(Train("1A05", Position("D1", Distance(offset)), **kwargs))


def test_a_train_added_occupies_its_section(world):
    down_train(world)
    assert "TA" in world.occupancy()
    assert world.log.about("1A05")[0].message == "enters at D1->100m"


def test_a_train_cannot_be_added_twice(world):
    down_train(world)
    with pytest.raises(KeyError, match="already on the layout"):
        down_train(world)


def test_removing_a_train_clears_its_track(world):
    down_train(world)
    world.remove("1A05")
    assert world.occupancy() == set()
    assert world.trains == {}


def test_removing_a_train_that_is_not_there_is_harmless(world):
    world.remove("9Z99")


def test_an_unknown_train_is_reported(world):
    with pytest.raises(KeyError, match="no train called"):
        world.train("9Z99")


def test_a_train_facing_a_red_stops_short_of_it(world):
    train = down_train(world, offset=100.0, speed=Speed.from_mph(40))
    for _ in range(60):
        world.step(5.0)
    assert not train.moving
    assert train.front.offset.metres < 560.0
    assert train.front.offset.metres > 500.0


def test_a_train_with_a_route_set_runs_through(world):
    train = down_train(world, offset=100.0, speed=Speed.from_mph(30))
    assert world.request("K1(M)")
    world.step(1.0)
    assert world.machine.showing("K1") is Aspect.YELLOW
    for _ in range(40):
        world.step(5.0)
    assert train.front.edge in ("D2", "D3")


def test_the_train_puts_the_signal_back_behind_it(world):
    down_train(world, offset=500.0, speed=Speed.from_mph(30))
    world.request("K1(M)")
    world.step(1.0)
    for _ in range(20):
        world.step(2.0)
    assert world.machine.showing("K1") is Aspect.RED


def test_line_speed_is_the_lower_of_track_and_train(world):
    slow = down_train(world, max_speed=Speed.from_mph(45))
    assert world.line_speed(slow) == Speed.from_mph(45)
    world.remove("1A05")
    fast = down_train(world, max_speed=Speed.from_mph(125))
    assert world.line_speed(fast) == Speed.from_mph(90)


def test_the_sighting_is_the_signal_in_front(world):
    train = down_train(world)
    sighting = world.sighting_for(train)
    assert sighting.signal == "K1"
    assert sighting.aspect is Aspect.RED


def test_a_train_with_nothing_in_front_sees_nothing(world):
    train = world.add(Train("2B10", Position("D6", Distance(10.0))))
    assert world.sighting_for(train) is None


def test_the_points_the_interlocking_holds_are_the_ones_the_driver_sees(world):
    world.request("K3(MB)")
    world.machine.tick(10.0)
    assert world.lies()["P101"].value == "reverse"


def test_cancelling_a_route_is_noted(world):
    world.request("K1(M)")
    world.machine.tick(10.0)
    assert world.cancel("K1(M)")
    assert world.log.mentioning("cancelled")


def test_the_world_describes_itself(world):
    down_train(world)
    assert world.describe().startswith("t=0s 1 trains, 0 moving")
