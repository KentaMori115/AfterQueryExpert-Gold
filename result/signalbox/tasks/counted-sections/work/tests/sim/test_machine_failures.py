import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.sim.machine import Machine
from signalbox.sim.state import PointStatus, RouteStatus
from signalbox.topology.graph import Lie


@pytest.fixture
def machine(kingsmoor):
    return Machine(kingsmoor, build_interlocking(kingsmoor))


def settle(machine, seconds=10.0):
    machine.tick(seconds)
    return machine


def test_failing_points_under_a_set_route_names_the_route(machine):
    machine.request("K1(M)")
    settle(machine)
    outcome = machine.fail_points("P103")
    assert outcome
    assert "failed under K1(M)" in outcome.reason


def test_failing_points_nothing_is_using_says_so(machine):
    outcome = machine.fail_points("P102")
    assert outcome.reason == "P102 failed"


def test_a_route_over_failed_points_goes_back_to_danger(machine):
    machine.request("K1(M)")
    settle(machine)
    assert machine.showing("K1") is Aspect.YELLOW
    machine.fail_points("P103")
    assert machine.showing("K1") is Aspect.RED


def test_a_route_cannot_be_set_over_failed_points(machine):
    machine.fail_points("P101")
    outcome = machine.request("K3(MB)")
    assert not outcome
    assert "has failed" in outcome.reason


def test_restoring_detection_lets_the_signal_clear_again(machine):
    machine.request("K1(M)")
    settle(machine)
    machine.fail_points("P103")
    machine.restore_points("P103")
    assert machine.state.point("P103").status is PointStatus.DETECTED
    assert machine.showing("K1") is Aspect.YELLOW


def test_restoring_settles_a_route_that_was_still_called(machine):
    machine.request("K3(MB)")
    assert machine.state.route("K3(MB)").status is RouteStatus.CALLED
    machine.state.point("P101").lie = Lie.REVERSE
    machine.restore_points("P101")
    assert machine.state.route("K3(MB)").status is RouteStatus.SET


def test_an_emergency_release_on_an_unset_route_is_refused(machine):
    outcome = machine.emergency_release("K1(M)")
    assert not outcome
    assert "not set" in outcome.reason


def test_an_emergency_release_runs_a_timer(machine):
    machine.request("K1(M)")
    settle(machine)
    outcome = machine.emergency_release("K1(M)")
    assert outcome and "emergency release running" in outcome.reason
    assert machine.state.route("K1(M)").status is RouteStatus.RELEASING


def test_the_route_comes_back_when_the_timer_runs_out(machine):
    machine.request("K1(M)")
    settle(machine)
    machine.emergency_release("K1(M)")
    machine.tick(60.0)
    assert machine.state.route("K1(M)").status is RouteStatus.RELEASING
    machine.tick(400.0)
    assert machine.state.route("K1(M)").status is RouteStatus.AVAILABLE


def test_a_shunt_route_is_released_at_once(machine):
    machine.request("K20(S)")
    settle(machine)
    outcome = machine.emergency_release("K20(S)")
    assert outcome
    assert machine.state.route("K20(S)").status is RouteStatus.AVAILABLE


def test_the_emergency_timer_is_longer_than_the_approach_release(machine):
    assert machine.emergency["K1(M)"].delay > machine.approach["K1(M)"].delay


def test_the_overlap_stops_being_proved_once_the_route_ahead_takes_it(machine):
    machine.request("K1(M)")
    settle(machine)
    assert machine.showing("K1") is Aspect.YELLOW
    assert machine.request("K3(MB)")
    settle(machine)
    # P101 has gone reverse under K3(MB), which was K1(M)'s overlap.
    assert machine.lie_of("P101") is Lie.REVERSE
    assert machine.showing("K1") is Aspect.DOUBLE_YELLOW


def test_the_points_to_prove_shrink_when_the_overlap_is_taken(machine):
    machine.request("K1(M)")
    settle(machine)
    assert "P101" in machine._points_to_prove("K1(M)")
    machine.request("K3(MB)")
    settle(machine)
    assert "P101" not in machine._points_to_prove("K1(M)")
