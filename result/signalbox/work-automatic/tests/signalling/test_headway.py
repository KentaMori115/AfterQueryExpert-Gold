import pytest

from signalbox.signalling.headway import (
    PLANNING_TRAIN,
    best,
    legs,
    line_headway,
    summarise,
    trains_per_hour,
    worst,
)
from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance


@pytest.fixture
def found(kingsmoor):
    return legs(kingsmoor, build_interlocking(kingsmoor))


def test_the_planning_train_is_two_hundred_metres():
    assert PLANNING_TRAIN.metres == 200.0


def test_every_main_route_between_signals_gets_a_leg(found):
    routes = {leg.route for leg in found}
    assert "K1(M)" in routes
    assert "K5(M)" not in routes


def test_shunt_routes_are_not_measured(found):
    assert all(not leg.route.endswith("(S)") for leg in found)


def test_a_leg_carries_its_length_and_speed(found):
    leg = next(leg for leg in found if leg.route == "K1(M)")
    assert leg.length.metres == pytest.approx(500.0)
    assert leg.speed.mph == pytest.approx(90.0)
    assert leg.heads == 4


def test_headway_converts_to_minutes_and_trains_an_hour(found):
    leg = found[0]
    assert leg.minutes == pytest.approx(leg.seconds / 60.0)
    assert leg.trains_per_hour == pytest.approx(3600.0 / leg.seconds)


def test_the_worst_block_decides_the_line(found):
    assert line_headway(found) == worst(found).seconds
    assert best(found).seconds <= worst(found).seconds


def test_a_longer_train_makes_the_headway_worse(kingsmoor):
    lock = build_interlocking(kingsmoor)
    short = line_headway(legs(kingsmoor, lock, train=Distance(80.0)))
    long = line_headway(legs(kingsmoor, lock, train=Distance(400.0)))
    assert long > short


def test_trains_an_hour_falls_as_the_headway_grows(found):
    assert trains_per_hour(found) == pytest.approx(3600.0 / line_headway(found))


def test_a_scheme_with_no_blocks_measures_nothing():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 speed 40 direction down
    section TA over E1
    signal S1 on E1 at 200 facing forward direction down
    """)
    found = legs(scheme, build_interlocking(scheme))
    assert found == []
    assert line_headway(found) == 0.0
    assert trains_per_hour(found) == 0.0
    assert summarise(found) == "no blocks to measure"
    assert worst(found) is None and best(found) is None


def test_track_with_no_speed_is_skipped():
    scheme = scheme_from_text("""
    node A boundary
    node J plain
    node B boundary
    edge E1 from A to J length 800 direction down
    edge E2 from J to B length 800 direction down
    section TA over E1
    section TB over E2
    signal S1 on E1 at 400 facing forward direction down
    signal S3 on E2 at 400 facing forward direction down
    """)
    assert legs(scheme, build_interlocking(scheme)) == []


def test_the_summary_names_the_worst_block(found):
    summary = summarise(found)
    assert "blocks, worst" in summary
    assert "trains an hour" in summary


def test_legs_print_readably(found):
    leg = next(leg for leg in found if leg.route == "K1(M)")
    assert str(leg) == "K1 to K3: 500m at 90 mph, 42s"
