import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.graph import Sense
from signalbox.topology.profile import STEEP, Profile, Stretch, profile
from signalbox.units import Distance, Gradient


def test_an_empty_profile_says_so():
    empty = Profile()
    assert len(empty) == 0
    assert empty.describe() == "no track to profile"
    assert empty.steepest() is None
    assert empty.worst_falling() is None


def test_a_rising_edge_gains_height(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL),))
    assert found.rise > 0
    assert not found.stretches[0].falling


def test_running_the_other_way_loses_it(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.REVERSE),))
    assert found.rise < 0
    assert found.stretches[0].falling


def test_a_falling_edge_is_reported(kingsmoor):
    found = profile(kingsmoor.graph, (("D5", Sense.NOMINAL),))
    assert found.rise < 0
    assert found.worst_falling().edge == "D5"


def test_level_track_gains_nothing(kingsmoor):
    found = profile(kingsmoor.graph, (("D2", Sense.NOMINAL),))
    assert found.stretches[0].level
    assert found.rise == pytest.approx(0.0)


def test_the_length_is_the_length_of_the_edges(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL), ("D2", Sense.NOMINAL)))
    assert found.length.metres == pytest.approx(600.0)


def test_up_and_down_are_counted_separately(kingsmoor):
    found = profile(
        kingsmoor.graph, (("D1", Sense.NOMINAL), ("D3", Sense.NOMINAL), ("D5", Sense.NOMINAL))
    )
    assert found.climbed() > 0
    assert found.dropped() > 0


def test_a_summit_is_where_it_stops_rising(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL), ("D5", Sense.NOMINAL)))
    assert found.summits() == ["D1"]


def test_a_run_that_only_rises_has_no_summit(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL),))
    assert found.summits() == []


def test_the_steepest_stretch_is_found(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL), ("D5", Sense.NOMINAL)))
    assert found.steepest().edge == "D5"


def test_steep_track_is_picked_out():
    stretch = Stretch("E1", Distance(1000.0), Gradient.parse("1 in 50"), 20.0)
    assert stretch.steep
    gentle = Stretch("E2", Distance(1000.0), Gradient.parse(f"1 in {STEEP * 4:g}"), 5.0)
    assert not gentle.steep


def test_level_track_is_never_steep():
    assert not Stretch("E1", Distance(100.0), Gradient.level(), 0.0).steep


def test_the_profile_describes_itself(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL), ("D5", Sense.NOMINAL)))
    text = found.describe()
    assert "up" in text and "down" in text and "net" in text


def test_a_route_can_be_profiled(kingsmoor):
    route = build_interlocking(kingsmoor).plan("K1(M)").route
    found = profile(kingsmoor.graph, route.path.steps)
    assert len(found) == len(route.edges)


def test_stretches_print_readably(kingsmoor):
    found = profile(kingsmoor.graph, (("D1", Sense.NOMINAL),))
    assert str(found.stretches[0]) == "D1: 560m at 1 in 330"
