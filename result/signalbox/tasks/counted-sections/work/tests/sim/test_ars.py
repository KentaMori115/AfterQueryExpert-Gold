import pytest

from signalbox.sim.ars import Ars, Booking
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.graph import Sense
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    return build_world(kingsmoor)


@pytest.fixture
def ars(world):
    return Ars(world)


def down_train(world, offset=60.0, name="1A05"):
    return world.add(Train(name, Position("D1", Distance(offset)), speed=Speed.from_mph(20)))


def test_a_booking_counts_down():
    booking = Booking("1A05", ["K1(M)", "K3(MA)"])
    assert booking.next_route == "K1(M)"
    booking.advance()
    assert booking.next_route == "K3(MA)"
    booking.advance()
    assert booking.finished and booking.next_route is None


def test_a_booking_prints_what_is_left():
    booking = Booking("1A05", ["K1(M)", "K3(MA)"])
    assert str(booking) == "1A05: 2 of 2 routes left"


def test_a_route_is_set_when_the_train_comes_near(world, ars):
    down_train(world)
    ars.book("1A05", ["K1(M)"])
    assert ars.step() == ["K1(M)"]
    assert ars.granted == 1


def test_a_route_is_not_set_for_a_train_that_is_too_far_away(world):
    world.add(Train("1A05", Position("U1", Distance(0.0))))
    ars = Ars(world, setting_distance=Distance(10.0))
    ars.book("1A05", ["K6(M)"])
    assert ars.step() == []


def test_a_route_for_a_signal_the_train_is_not_facing_is_not_set(world, ars):
    down_train(world)
    ars.book("1A05", ["K6(M)"])
    assert ars.step() == []


def test_a_booking_for_a_train_that_is_not_there_is_ignored(ars):
    ars.book("9Z99", ["K1(M)"])
    assert ars.step() == []


def test_a_route_already_set_is_skipped(world, ars):
    down_train(world)
    world.request("K1(M)")
    world.machine.tick(10.0)
    ars.book("1A05", ["K1(M)", "K3(MA)"])
    ars.step()
    assert ars.booking("1A05").done >= 1


def test_a_refusal_is_counted(world, ars):
    down_train(world)
    world.request("K1(S)")
    world.machine.tick(10.0)
    ars.book("1A05", ["K1(M)"])
    ars.step()
    assert ars.refused == 1
    assert ars.granted == 0


def test_running_takes_a_train_through_the_junction(world, ars):
    train = down_train(world)
    ars.book("1A05", ["K1(M)", "K3(MB)"])
    ars.run(400.0, step=2.0)
    assert train.front.edge in ("D7", "D8")
    assert ars.granted == 2


def test_the_log_says_what_the_setting_did(world, ars):
    down_train(world)
    ars.book("1A05", ["K1(M)"])
    ars.run(20.0, step=2.0)
    assert world.log.mentioning("automatic route setting")


def test_the_summary_counts_everything(world, ars):
    down_train(world)
    ars.book("1A05", ["K1(M)"])
    ars.run(20.0, step=2.0)
    summary = ars.describe()
    assert "1 trains booked" in summary
    assert "routes set" in summary


def test_an_unbooked_train_is_left_alone(world, ars):
    train = down_train(world)
    ars.run(120.0, step=2.0)
    assert not train.moving
    assert train.front.edge == "D1"


def test_a_booking_carries_the_class_of_train(world, ars):
    from signalbox.sim.regulator import Class

    booking = ars.book("1A05", ["K1(M)"], Class.EXPRESS)
    assert booking.klass is Class.EXPRESS


def test_waiting_time_starts_when_the_route_is_first_wanted(world, ars):
    down_train(world)
    ars.book("1A05", ["K1(M)"])
    ars._candidates()
    assert ars.bookings["1A05"].asking_since == 0.0
    world.step(10.0)
    assert ars.bookings["1A05"].waiting(world.clock) == 10.0


def test_waiting_time_resets_once_the_route_is_set(world, ars):
    down_train(world)
    ars.book("1A05", ["K1(M)", "K3(MA)"])
    ars.step()
    assert ars.bookings["1A05"].asking_since is None


def test_an_express_is_asked_for_before_a_stopper(world, ars):
    from signalbox.sim.regulator import Class

    world.add(Train("2B10", Position("D1", Distance(60.0)), speed=Speed.from_mph(20)))
    world.add(
        Train(
            "1A05",
            Position("U8", Distance(40.0), Sense.REVERSE),
            speed=Speed.from_mph(20),
        )
    )
    ars.book("2B10", ["K1(M)"], Class.STOPPER)
    ars.book("1A05", ["K2(M)"], Class.EXPRESS)
    assert ars.step()[0] == "K2(M)"


def test_a_class_can_be_booked_in_a_scenario(kingsmoor):
    from signalbox.sim.scenario import parse_scenario, run_scenario

    scenario = parse_scenario(
        "scenario x {\n step 2\n until 60\n}\n"
        "at 0 train 1A05 on D1 at 60 speed 20\n"
        'at 0 book 1A05 express "K1(M)"\n'
    )
    result = run_scenario(kingsmoor, scenario)
    assert result.passed, result.failures
    assert result.ars.granted == 1


def test_a_class_with_no_routes_is_reported(kingsmoor):
    from signalbox.sim.scenario import parse_scenario, run_scenario

    scenario = parse_scenario("scenario x {\n step 2\n until 10\n}\nat 0 book 1A05 express\n")
    result = run_scenario(kingsmoor, scenario)
    assert "expected: book TRAIN CLASS ROUTE" in result.failures[0]
