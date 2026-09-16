"""The aspects on their own, without going through the machine to get at them."""

from __future__ import annotations

import pytest

from signalbox.signalling.aspects import build_chart
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.sim.lamps import Lamps
from signalbox.sim.machine import Machine
from signalbox.sim.state import RouteState, RouteStatus, SchemeState
from signalbox.topology.graph import Lie


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


@pytest.fixture
def lamps(kingsmoor, lock):
    state = SchemeState()
    for plan in lock:
        state.routes[plan.name] = RouteState(plan.name)
    for name in kingsmoor.graph.movable():
        from signalbox.sim.state import PointState

        state.points[name] = PointState(name)
    return Lamps(kingsmoor, lock, build_chart(kingsmoor, lock), state)


def test_everything_is_at_danger_to_begin_with(lamps, kingsmoor):
    lamps.refresh()
    assert all(lamps.showing(name) is Aspect.RED for name in kingsmoor.signals)


def test_no_route_set_means_no_route_from_a_signal(lamps):
    assert lamps.route_set_from("K1") is None


def test_a_set_route_is_found(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.SET
    assert lamps.route_set_from("K1") == "K1(M)"


def test_an_occupied_route_is_still_the_route_that_is_set(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.OCCUPIED
    assert lamps.route_set_from("K1") == "K1(M)"


def test_a_route_that_is_only_called_is_not_set(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.CALLED
    assert lamps.route_set_from("K1") is None


def test_the_points_a_route_has_to_prove(lamps):
    wanted = lamps.points_to_prove("K1(M)")
    assert wanted["P103"] is Lie.NORMAL
    assert "P104" in wanted


def test_a_set_route_clears_its_signal(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.SET
    lamps.refresh()
    assert lamps.showing("K1") is Aspect.YELLOW


def test_occupied_track_puts_it_back(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.SET
    lamps.state.occupy("TB")
    lamps.refresh()
    assert lamps.showing("K1") is Aspect.RED


def test_points_the_wrong_way_keep_it_at_danger(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.SET
    lamps.state.point("P103").lie = Lie.REVERSE
    lamps.refresh()
    assert lamps.showing("K1") is Aspect.RED


def test_a_dark_signal_shows_red_whatever_is_set(lamps):
    lamps.state.route("K1(M)").status = RouteStatus.SET
    lamps.state.darken("K1")
    assert lamps.aspect_of("K1") is Aspect.RED


def test_the_machine_uses_the_same_lamps(kingsmoor, lock):
    machine = Machine(kingsmoor, lock)
    machine.request("K1(M)")
    machine.tick(10.0)
    assert machine.showing("K1") is machine.lamps.showing("K1")
    assert machine.aspect_of("K1") is machine.lamps.aspect_of("K1")
