from signalbox.signalling.interlocking import build_interlocking
from signalbox.sim.machine import POINT_MOVE_SECONDS, Machine
from signalbox.sim.state import RouteStatus
from signalbox.topology.graph import Lie
from signalbox.topology.scheme import scheme_from_text

SLOW = """
node A boundary
node P1 points throw 20
node B boundary
node C boundary
edge E1 from A to P1.toe length 800 speed 40 direction down
edge E2 from P1.normal to B length 400 speed 40 direction down
edge E3 from P1.reverse to C length 400 speed 40 direction down
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 800 facing forward direction down
"""

HAND = SLOW.replace("node P1 points throw 20", "node P1 points motor hand")


def machine_for(text):
    scheme = scheme_from_text(text)
    return Machine(scheme, build_interlocking(scheme))


def test_the_default_throw_time_is_used_when_the_plan_says_nothing(kingsmoor):
    machine = Machine(kingsmoor, build_interlocking(kingsmoor))
    assert machine.throw_time("P101") == POINT_MOVE_SECONDS


def test_the_plan_can_make_a_set_of_points_slow():
    machine = machine_for(SLOW)
    assert machine.throw_time("P1") == 20.0


def test_slow_points_hold_the_route_up():
    machine = machine_for(SLOW)
    machine.request("S1(MB)")
    machine.tick(10.0)
    assert machine.state.route("S1(MB)").status is RouteStatus.CALLED
    machine.tick(15.0)
    assert machine.state.route("S1(MB)").status is RouteStatus.SET


def test_the_setting_time_is_the_slowest_set_of_points():
    machine = machine_for(SLOW)
    assert machine.setting_time("S1(MB)") == 20.0


def test_a_route_that_calls_nothing_sets_at_once():
    machine = machine_for(SLOW)
    assert machine.setting_time("S1(MA)") == 20.0
    machine.request("S1(MA)")
    assert machine.state.route("S1(MA)").status is RouteStatus.SET


def test_an_override_beats_what_the_plan_says():
    scheme = scheme_from_text(SLOW)
    machine = Machine(scheme, build_interlocking(scheme), point_seconds=1.0)
    assert machine.throw_time("P1") == 1.0


def test_hand_points_lying_the_right_way_are_allowed():
    machine = machine_for(HAND)
    assert machine.request("S1(MA)")


def test_hand_points_lying_the_wrong_way_refuse_the_route():
    machine = machine_for(HAND)
    outcome = machine.request("S1(MB)")
    assert not outcome
    assert "hand worked" in outcome.reason


def test_hand_points_can_be_pulled_over_by_hand_first():
    machine = machine_for(HAND)
    machine.state.point("P1").lie = Lie.REVERSE
    assert machine.request("S1(MB)")


def test_points_with_no_machine_fall_back_to_the_default(kingsmoor):
    machine = Machine(kingsmoor, build_interlocking(kingsmoor))
    machine.scheme.machines.pop("P101")
    assert machine.throw_time("P101") == POINT_MOVE_SECONDS
