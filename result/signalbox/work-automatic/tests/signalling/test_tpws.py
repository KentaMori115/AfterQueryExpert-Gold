import pytest

from signalbox.signalling.tpws import (
    DEFAULT_SET_SPEED,
    EMERGENCY_BRAKING,
    Grid,
    GridKind,
    all_grids,
    grids_for,
    oss_distance,
    signals_without_protection,
)
from signalbox.topology.position import Position
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance, Speed

SLOW_YARD = """
node A boundary
node B boundary
edge E1 from A to B length 800 speed 20 direction down
section TA over E1
signal S1 on E1 at 700 facing forward direction down
"""


def test_the_set_speed_is_thirty_five():
    assert DEFAULT_SET_SPEED.mph == pytest.approx(35.0)


def test_grid_kinds_know_where_they_sit():
    assert GridKind.TRAIN_STOP.is_at_the_signal
    assert not GridKind.OVERSPEED.is_at_the_signal
    assert str(GridKind.OVERSPEED) == "oss"


def test_the_overspeed_distance_follows_the_approach_speed():
    fast = oss_distance(Speed.from_mph(90))
    slow = oss_distance(Speed.from_mph(50))
    assert fast.metres > slow.metres


def test_the_formula_is_the_usual_one():
    approach = Speed.from_mph(75)
    expected = (approach.mps**2 - DEFAULT_SET_SPEED.mps**2) / (2 * EMERGENCY_BRAKING)
    assert oss_distance(approach).metres == pytest.approx(expected)


def test_below_the_set_speed_nothing_is_needed():
    assert oss_distance(Speed.from_mph(20)).metres == 0.0
    assert oss_distance(DEFAULT_SET_SPEED).metres == 0.0


def test_a_main_signal_gets_a_train_stop_grid(kingsmoor):
    grids = grids_for(kingsmoor, kingsmoor.signal("K1"))
    assert grids[0].kind is GridKind.TRAIN_STOP
    assert grids[0].name == "K1-TSS"


def test_a_main_signal_on_fast_line_also_gets_an_overspeed_grid(kingsmoor):
    grids = grids_for(kingsmoor, kingsmoor.signal("K1"))
    assert [grid.kind for grid in grids] == [GridKind.TRAIN_STOP, GridKind.OVERSPEED]
    assert grids[1].behind.metres > 0


def test_a_shunt_signal_gets_nothing(kingsmoor):
    assert grids_for(kingsmoor, kingsmoor.signal("K20")) == []


def test_a_signal_on_slow_line_gets_only_a_train_stop():
    scheme = scheme_from_text(SLOW_YARD)
    grids = grids_for(scheme, scheme.signal("S1"))
    assert [grid.kind for grid in grids] == [GridKind.TRAIN_STOP]


def test_a_signal_on_track_with_no_speed_gets_only_a_train_stop():
    scheme = scheme_from_text(SLOW_YARD.replace(" speed 20", ""))
    assert len(grids_for(scheme, scheme.signal("S1"))) == 1


def test_a_lower_set_speed_puts_the_grid_further_back(kingsmoor):
    high = grids_for(kingsmoor, kingsmoor.signal("K1"), set_speed=Speed.from_mph(45))
    low = grids_for(kingsmoor, kingsmoor.signal("K1"), set_speed=Speed.from_mph(20))
    assert low[1].behind.metres > high[1].behind.metres


def test_every_main_signal_is_covered(kingsmoor):
    grids = all_grids(kingsmoor)
    names = {grid.signal for grid in grids}
    assert "K1" in names
    assert "K20" not in names


def test_signals_without_an_overspeed_grid_are_listed():
    scheme = scheme_from_text(SLOW_YARD)
    assert signals_without_protection(scheme) == ["S1"]
    from signalbox.topology.scheme import Scheme  # noqa: F401


def test_kingsmoor_main_signals_are_all_protected(kingsmoor):
    assert signals_without_protection(kingsmoor) == []


def test_grids_describe_themselves():
    at = Position("E1", Distance(100.0))
    assert str(Grid("S1-TSS", GridKind.TRAIN_STOP, at)) == "S1-TSS at the signal"
    oss = Grid("S1-OSS", GridKind.OVERSPEED, at, Speed.from_mph(35), Distance(240.0))
    assert str(oss) == "S1-OSS 240m in rear, set at 35 mph"
    assert oss.signal == "S1"
