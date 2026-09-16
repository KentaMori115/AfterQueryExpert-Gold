import pytest

from signalbox.signalling.braking import BrakingModel
from signalbox.signalling.signal import Aspect
from signalbox.sim.driver import STOP_MARGIN, Driver, Sighting, signal_ahead
from signalbox.topology.graph import Lie, Sense
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def driver():
    return Driver()


def test_the_next_signal_on_the_same_edge_is_found(kingsmoor):
    found = signal_ahead(kingsmoor, Position("D1", Distance(100.0)))
    assert found == ("K1", Distance(460.0))


def test_a_signal_on_a_later_edge_is_found(kingsmoor):
    found = signal_ahead(kingsmoor, Position("D2", Distance(0.0)))
    assert found[0] == "K3"
    assert found[1].metres == pytest.approx(500.0)


def test_the_points_decide_which_signal_is_ahead(kingsmoor):
    at = Position("D4", Distance(0.0))
    assert signal_ahead(kingsmoor, at)[0] == "K5"
    assert signal_ahead(kingsmoor, at, {"P101": Lie.REVERSE})[0] == "K7"


def test_a_signal_standing_where_we_are_is_not_ahead(kingsmoor):
    # K1 is at the far end of D1, so a train whose front is there has passed it.
    found = signal_ahead(kingsmoor, Position("D1", Distance(560.0)))
    assert found[0] == "K3"


def test_looking_a_short_way_finds_nothing(kingsmoor):
    at = Position("D1", Distance(100.0))
    assert signal_ahead(kingsmoor, at, limit=Distance(50.0)) is None


def test_running_off_the_end_finds_nothing(kingsmoor):
    assert signal_ahead(kingsmoor, Position("D6", Distance(0.0))) is None


def test_a_train_going_the_other_way_sees_the_up_signals(kingsmoor):
    found = signal_ahead(kingsmoor, Position("U8", Distance(40.0), Sense.REVERSE))
    assert found[0] == "K2"


def test_stopping_speed_grows_with_room(driver):
    near = driver.stopping_speed(Distance(100.0))
    far = driver.stopping_speed(Distance(1000.0))
    assert far.mps > near.mps


def test_there_is_no_stopping_speed_inside_the_margin(driver):
    assert driver.stopping_speed(STOP_MARGIN).mps == 0.0
    assert driver.stopping_speed(Distance(0.0)).mps == 0.0


def test_a_red_close_ahead_means_stop(driver):
    sighting = Sighting("K3", Distance(15.0), Aspect.RED)
    assert driver.target_speed(Speed.from_mph(90), sighting).mps == 0.0
    assert driver.should_stop(sighting)


def test_a_green_means_line_speed(driver):
    sighting = Sighting("K3", Distance(1000.0), Aspect.GREEN)
    assert driver.target_speed(Speed.from_mph(60), sighting) == Speed.from_mph(60)
    assert not driver.should_stop(sighting)


def test_a_yellow_holds_the_speed_down(driver):
    yellow = Sighting("K3", Distance(600.0), Aspect.YELLOW)
    green = Sighting("K3", Distance(600.0), Aspect.GREEN)
    fast = Speed.from_mph(90)
    assert driver.target_speed(fast, yellow).mps < driver.target_speed(fast, green).mps


def test_a_double_yellow_sits_between_the_two(driver):
    fast = Speed.from_mph(90)
    at = Distance(600.0)
    yellow = driver.target_speed(fast, Sighting("K3", at, Aspect.YELLOW))
    double = driver.target_speed(fast, Sighting("K3", at, Aspect.DOUBLE_YELLOW))
    green = driver.target_speed(fast, Sighting("K3", at, Aspect.GREEN))
    assert yellow.mps <= double.mps <= green.mps


def test_seeing_nothing_means_line_speed(driver):
    assert driver.target_speed(Speed.from_mph(45), None) == Speed.from_mph(45)
    assert not driver.should_stop(None)


def test_a_known_block_length_is_used_instead_of_guessing(driver):
    sighting = Sighting("K3", Distance(400.0), Aspect.YELLOW)
    with_block = driver.target_speed(Speed.from_mph(90), sighting, block=Distance(2000.0))
    without = driver.target_speed(Speed.from_mph(90), sighting)
    assert with_block.mps > without.mps


def test_a_gentler_brake_means_a_lower_speed():
    slack = Driver(braking=BrakingModel(rate=0.2))
    keen = Driver(braking=BrakingModel(rate=0.8))
    room = Distance(500.0)
    assert slack.stopping_speed(room).mps < keen.stopping_speed(room).mps


def test_sightings_print_readably():
    sighting = Sighting("K3", Distance(420.0), Aspect.YELLOW)
    assert str(sighting) == "K3 at 420m showing Y"
