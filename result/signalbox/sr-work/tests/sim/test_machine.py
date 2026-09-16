import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.sim.machine import Machine, Outcome
from signalbox.sim.state import RouteStatus
from signalbox.topology.graph import Lie


@pytest.fixture
def machine(kingsmoor):
    return Machine(kingsmoor, build_interlocking(kingsmoor))


def settle(machine, seconds=10.0):
    machine.tick(seconds)
    return machine


def test_everything_starts_at_danger_and_normal(machine):
    assert all(aspect is Aspect.RED for aspect in machine.state.aspects.values())
    assert machine.lie_of("P101") is Lie.NORMAL
    assert not machine.state.held_routes()


def test_setting_a_route_calls_it_then_sets_it(machine):
    assert machine.request("K1(M)")
    assert machine.state.route("K1(M)").status is RouteStatus.SET


def test_a_route_that_needs_points_waits_for_detection(machine):
    machine.request("K3(MB)")
    assert machine.state.route("K3(MB)").status is RouteStatus.CALLED
    assert machine.showing("K3") is Aspect.RED
    settle(machine)
    assert machine.state.route("K3(MB)").status is RouteStatus.SET
    assert machine.lie_of("P101") is Lie.REVERSE


def test_a_set_route_clears_its_signal(machine):
    machine.request("K1(M)")
    settle(machine)
    assert machine.showing("K1") is Aspect.YELLOW


def test_two_routes_in_sequence_step_the_aspects_up(machine):
    machine.request("K1(M)")
    machine.request("K3(MA)")
    settle(machine)
    # K5 is still at danger, so K3 gets a yellow and K1 a double yellow.
    assert machine.showing("K5") is Aspect.RED
    assert machine.showing("K3") is Aspect.YELLOW
    assert machine.showing("K1") is Aspect.DOUBLE_YELLOW


def test_a_clear_road_puts_green_all_the_way_back(machine):
    for route in ("K1(M)", "K3(MA)", "K5(M)"):
        machine.request(route)
    settle(machine)
    assert machine.showing("K5") is Aspect.GREEN
    assert machine.showing("K3") is Aspect.GREEN
    assert machine.showing("K1") is Aspect.GREEN


def test_an_unknown_route_is_refused(machine):
    outcome = machine.request("K99(M)")
    assert not outcome
    assert "no route called" in outcome.reason


def test_a_route_cannot_be_set_twice(machine):
    machine.request("K1(M)")
    outcome = machine.request("K1(M)")
    assert not outcome
    assert "already" in outcome.reason


def test_a_following_route_may_be_set_through_the_overlap(machine):
    assert machine.request("K1(M)")
    settle(machine)
    assert machine.request("K3(MA)")
    settle(machine)
    assert machine.showing("K1") is Aspect.DOUBLE_YELLOW


def test_a_conflicting_route_is_refused(machine):
    machine.request("K3(MA)")
    settle(machine)
    outcome = machine.request("K3(MB)")
    assert not outcome
    assert "set against it" in outcome.reason


def test_a_route_over_occupied_track_is_refused(machine):
    machine.occupy("TB")
    outcome = machine.request("K1(M)")
    assert not outcome
    assert "TB is occupied" in outcome.reason


def test_a_shunt_route_may_be_set_into_occupied_track(machine):
    machine.occupy("TU")
    assert machine.request("K20(S)")


def test_a_train_entering_the_route_puts_the_signal_back(machine):
    machine.request("K1(M)")
    settle(machine)
    machine.occupy("TB")
    assert machine.showing("K1") is Aspect.RED
    assert machine.state.route("K1(M)").status is RouteStatus.OCCUPIED


def test_the_route_releases_behind_the_train(machine):
    machine.request("K1(M)")
    settle(machine)
    for section in ("TB", "TC", "TD", "TE"):
        machine.occupy(section)
        machine.clear(section)
    assert machine.state.route("K1(M)").status is RouteStatus.AVAILABLE
    assert machine.state.holder_of(machine.entry("K1(M)").subroutes[0]) is None


def test_cancelling_an_unset_route_is_refused(machine):
    outcome = machine.cancel("K1(M)")
    assert not outcome
    assert "not set" in outcome.reason


def test_cancelling_with_nothing_approaching_releases_at_once(machine):
    machine.request("K1(M)")
    settle(machine)
    assert machine.cancel("K1(M)")
    assert machine.state.route("K1(M)").status is RouteStatus.AVAILABLE


def test_cancelling_with_a_train_approaching_waits(machine):
    machine.request("K3(MA)")
    settle(machine)
    machine.occupy("TC")
    outcome = machine.cancel("K3(MA)")
    assert outcome and "approach locked" in outcome.reason
    assert machine.state.route("K3(MA)").status is RouteStatus.RELEASING
    machine.tick(300.0)
    assert machine.state.route("K3(MA)").status is RouteStatus.AVAILABLE


def test_outcomes_print_readably():
    assert str(Outcome(True)) == "accepted"
    assert str(Outcome(False, "TB is occupied")) == "refused: TB is occupied"
    assert not Outcome(False, "no")


def test_the_overlap_does_not_have_to_be_run_over_to_release(machine):
    machine.request("K1(M)")
    settle(machine)
    for section in ("TB", "TC"):
        machine.occupy(section)
        machine.clear(section)
    assert machine.state.route("K1(M)").status is RouteStatus.AVAILABLE
    assert machine.state.held_by("K1(M)") == []


def test_asking_whether_a_route_would_set_changes_nothing(machine):
    outcome = machine.would_refuse("K1(M)")
    assert outcome
    assert machine.state.route("K1(M)").status is RouteStatus.AVAILABLE
    assert not machine.state.held_routes()


def test_a_refusal_can_be_asked_for_without_setting_anything(machine):
    machine.request("K3(MA)")
    settle(machine)
    outcome = machine.would_refuse("K3(MB)")
    assert not outcome
    assert "set against it" in outcome.reason
    assert machine.state.route("K3(MB)").status is RouteStatus.AVAILABLE


def test_the_dry_run_leaves_the_points_alone(machine):
    machine.would_refuse("K3(MB)")
    assert machine.lie_of("P101") is Lie.NORMAL
