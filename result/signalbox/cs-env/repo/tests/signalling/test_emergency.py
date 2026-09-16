import pytest

from signalbox.signalling.approach import ApproachKind, ApproachLock
from signalbox.signalling.emergency import (
    MINIMUM_DELAY,
    EmergencyRelease,
    delay_for,
    release_for,
)
from signalbox.signalling.route import RouteClass
from signalbox.units import Speed


def lock(delay=120.0, kind=ApproachKind.TRACK_AND_TIME):
    return ApproachLock("K1(M)", kind, ("TA",), delay)


def test_a_route_that_clears_nothing_comes_back_at_once():
    assert delay_for(lock(), RouteClass.SHUNT) == 0.0
    assert delay_for(lock(), RouteClass.CALL_ON) == 0.0


def test_a_main_route_waits_at_least_the_minimum():
    assert delay_for(lock(delay=10.0), RouteClass.MAIN) == MINIMUM_DELAY


def test_a_long_approach_release_makes_a_longer_emergency_release():
    assert delay_for(lock(delay=200.0), RouteClass.MAIN) == pytest.approx(300.0)


def test_a_fast_line_makes_a_longer_release():
    slow = delay_for(lock(), RouteClass.MAIN, Speed.from_mph(30))
    fast = delay_for(lock(), RouteClass.MAIN, Speed.from_mph(125))
    assert fast > slow
    assert fast == pytest.approx(312.5)


def test_the_minimum_can_be_lowered_for_a_slow_area():
    assert delay_for(lock(delay=10.0), RouteClass.MAIN, minimum=60.0) == 60.0


def test_a_release_carries_a_reason():
    release = release_for("K1(M)", lock(), RouteClass.MAIN)
    assert not release.immediate
    assert "may already have seen it" in release.reason


def test_an_immediate_release_says_why():
    release = release_for("K20(S)", lock(), RouteClass.SHUNT)
    assert release.immediate
    assert release.reason == "nothing to take away"
    assert release.describe() == "released at once"


def test_releases_print_readably():
    assert str(EmergencyRelease("K1(M)", 180.0)) == "K1(M): released after 180s"
    assert str(EmergencyRelease("K20(S)", 0.0)) == "K20(S): released at once"


def test_a_warning_route_clears_a_signal_so_it_waits():
    assert delay_for(lock(), RouteClass.WARNING) >= MINIMUM_DELAY
