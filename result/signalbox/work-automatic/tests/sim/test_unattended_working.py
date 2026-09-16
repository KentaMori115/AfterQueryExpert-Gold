"""An automatic signal being worked, which is to say working itself.

The plan level says which signals may be left to the trains. This is what
happens once the railway is running: a route nobody asked for, a signal that
comes back on its own behind a train, and the one control a signaller still has
over it.
"""

from __future__ import annotations

import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.sim.machine import Machine
from signalbox.sim.scenario import parse_scenario, run_scenario
from signalbox.sim.state import RouteStatus
from signalbox.topology.scheme import scheme_from_text

#: Down line worked one way, with S3 left to the trains. S8 reads back over the
#: same track, so it is the move a signaller loses while S3 stands set.
LINE = """
scheme bothways { area "Bothways" prefix S }
standards {
    flank 1200
}
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 1400 speed 60 gradient level direction bidirectional
edge E2 from J1 to J2 length 1400 speed 60 gradient level direction bidirectional
edge E3 from J2 to J3 length 1400 speed 60 gradient level direction bidirectional
edge E4 from J3 to B length 1400 speed 60 gradient level direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 1400 facing forward direction down aspects 4 sighting 300
signal S3 on E2 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
signal S5 on E3 at 1400 facing forward direction down aspects 4 sighting 300
signal S8 on E3 at 1400 facing backward direction up aspects 4 sighting 300
"""

#: Two automatic signals one behind the other, which is what a long stretch of
#: plain line between two junctions actually looks like.
RUN = """
scheme runthrough { area "Runthrough" prefix S }
standards {
    flank 1200
}
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 1400 speed 60 gradient level direction down
edge E2 from J1 to J2 length 1400 speed 60 gradient level direction down
edge E3 from J2 to J3 length 1400 speed 60 gradient level direction down
edge E4 from J3 to B length 1400 speed 60 gradient level direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 1400 facing forward direction down aspects 4 sighting 300
signal S3 on E2 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
signal S5 on E3 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
"""

AUTO = "S3(M)"
OPPOSING = "S8(M)"


@pytest.fixture
def scheme():
    return scheme_from_text(LINE)


@pytest.fixture
def machine(scheme):
    return Machine(scheme, build_interlocking(scheme))


def status(machine: Machine, route: str) -> RouteStatus:
    return machine.state.route(route).status


def run(text: str, scheme, until: float = 60.0, step: float = 2.0):
    script = f"scenario x {{\n    step {step:.0f}\n    until {until:.0f}\n}}\n" + text
    return run_scenario(scheme, parse_scenario(script))


def test_the_route_is_there_before_anybody_asks_for_it(machine):
    assert status(machine, AUTO) is RouteStatus.SET


def test_the_signal_clears_itself(machine):
    assert machine.showing("S3").is_proceed


def test_a_route_the_signaller_works_is_not_set_to_begin_with(machine):
    assert status(machine, "S1(M)") is RouteStatus.AVAILABLE
    assert status(machine, AUTO) is RouteStatus.SET


def test_asking_for_it_is_refused(machine):
    assert not machine.request(AUTO)
    assert status(machine, AUTO) is RouteStatus.SET


def test_asking_for_it_is_refused_even_when_it_is_replaced(machine):
    machine.replace("S3")
    assert not machine.request(AUTO)
    assert status(machine, AUTO) is RouteStatus.AVAILABLE
    assert machine.showing("S3") is Aspect.RED


def test_asking_without_setting_says_the_same_thing(machine):
    assert not machine.would_refuse(AUTO)
    assert status(machine, AUTO) is RouteStatus.SET


def test_cancelling_it_is_refused(machine):
    assert not machine.cancel(AUTO)
    assert status(machine, AUTO) is RouteStatus.SET


def test_cancelling_it_leaves_the_signal_clear(machine):
    machine.cancel(AUTO)
    assert machine.showing("S3").is_proceed


def test_releasing_it_is_refused(machine):
    assert not machine.emergency_release(AUTO)
    assert status(machine, AUTO) is RouteStatus.SET


def test_replacing_the_signal_takes_the_route_away(machine):
    assert machine.replace("S3")
    assert status(machine, AUTO) is RouteStatus.AVAILABLE


def test_a_replaced_signal_is_at_danger(machine):
    machine.replace("S3")
    assert machine.showing("S3") is Aspect.RED


def test_a_replaced_signal_stays_replaced(machine):
    machine.replace("S3")
    machine.tick(600.0)
    assert status(machine, AUTO) is RouteStatus.AVAILABLE
    assert machine.showing("S3") is Aspect.RED


def test_replacing_twice_is_refused(machine):
    machine.replace("S3")
    assert not machine.replace("S3")


def test_a_signal_the_signaller_works_cannot_be_replaced(machine):
    assert not machine.replace("S1")


def test_giving_it_back_sets_the_route_again(machine):
    machine.replace("S3")
    assert machine.work_automatically("S3")
    assert status(machine, AUTO) is RouteStatus.SET


def test_giving_it_back_clears_the_signal_again(machine):
    machine.replace("S3")
    machine.work_automatically("S3")
    assert machine.showing("S3").is_proceed


def test_giving_back_a_signal_nobody_took_away_is_refused(machine):
    assert not machine.work_automatically("S3")


def test_giving_back_a_signal_the_trains_do_not_work_is_refused(machine):
    assert not machine.work_automatically("S5")


def test_the_opposing_move_is_refused_while_the_signal_is_working(machine):
    assert not machine.request(OPPOSING)


def test_the_opposing_move_can_be_had_once_the_signal_is_replaced(machine):
    machine.replace("S3")
    assert machine.request(OPPOSING)


def test_the_automatic_route_waits_while_the_opposing_move_holds_the_track(machine):
    machine.replace("S3")
    machine.request(OPPOSING)
    machine.work_automatically("S3")
    assert status(machine, AUTO) is RouteStatus.AVAILABLE


def test_the_automatic_route_takes_the_track_back_when_it_is_free(machine):
    machine.replace("S3")
    machine.request(OPPOSING)
    machine.work_automatically("S3")
    machine.cancel(OPPOSING)
    assert status(machine, AUTO) is RouteStatus.SET


def test_a_train_on_the_route_puts_the_signal_back(machine):
    machine.occupy("TC")
    assert machine.showing("S3") is Aspect.RED
    assert status(machine, AUTO) is RouteStatus.OCCUPIED


def test_a_failed_track_circuit_puts_the_signal_back(machine):
    assert machine.showing("S3").is_proceed
    machine.fail_section("TC")
    assert machine.showing("S3") is Aspect.RED


def test_the_signal_clears_again_when_the_track_circuit_is_put_right(machine):
    machine.fail_section("TC")
    machine.restore_section("TC")
    assert machine.showing("S3").is_proceed
    assert status(machine, AUTO) is RouteStatus.SET


def test_the_signal_comes_back_behind_the_train(machine):
    machine.occupy("TC")
    machine.clear("TC")
    assert status(machine, AUTO) is RouteStatus.SET
    assert machine.showing("S3").is_proceed


def test_replacing_with_a_train_coming_waits_for_the_approach_locking(machine):
    machine.occupy("TB")
    assert machine.showing("S3").is_proceed
    machine.replace("S3")
    assert status(machine, AUTO) is RouteStatus.RELEASING


def test_the_track_is_still_held_while_the_approach_locking_runs(machine):
    machine.occupy("TB")
    machine.replace("S3")
    machine.tick(30.0)
    assert status(machine, AUTO) is RouteStatus.RELEASING
    assert not machine.request(OPPOSING)


def test_the_route_goes_when_the_approach_locking_has_run(machine):
    machine.occupy("TB")
    machine.replace("S3")
    machine.tick(600.0)
    assert status(machine, AUTO) is RouteStatus.AVAILABLE


def test_the_signal_is_at_danger_from_the_moment_it_is_replaced(machine):
    machine.occupy("TB")
    machine.replace("S3")
    assert machine.showing("S3") is Aspect.RED


def test_it_does_not_set_itself_again_while_it_is_replaced(machine):
    machine.occupy("TB")
    machine.replace("S3")
    machine.tick(600.0)
    machine.clear("TB")
    machine.tick(60.0)
    assert status(machine, AUTO) is RouteStatus.AVAILABLE


def test_a_scenario_can_replace_the_signal(scheme):
    result = run("at 10 replace S3\nexpect signal S3 replaced\n", scheme)
    assert result.passed, result.failures


def test_a_replaced_signal_is_not_working(scheme):
    result = run(
        "at 10 replace S3\nexpect signal S3 replaced\nexpect signal S3 automatic\n",
        scheme,
    )
    assert len(result.failures) == 1


def test_a_scenario_can_give_the_signal_back(scheme):
    result = run(
        "at 10 replace S3\nat 20 automatic S3\nexpect signal S3 automatic\n", scheme
    )
    assert result.passed, result.failures


def test_a_signal_left_alone_is_working(scheme):
    result = run("expect signal S3 automatic\n", scheme)
    assert result.passed, result.failures


def test_a_signal_left_alone_is_not_replaced(scheme):
    result = run(
        "expect signal S3 automatic\nexpect signal S3 replaced\n", scheme
    )
    assert len(result.failures) == 1


def test_a_scenario_leaves_the_route_up_where_nobody_touches_it(scheme):
    result = run('expect route "S3(M)" is set\n', scheme)
    assert result.passed, result.failures


def test_a_scenario_sees_the_route_go_when_the_signal_is_replaced(scheme):
    result = run(
        'at 10 replace S3\nexpect route "S3(M)" is available\n', scheme, until=40
    )
    assert result.passed, result.failures


def test_replacing_a_signal_the_trains_do_not_work_is_a_scenario_failure(scheme):
    result = run("at 10 replace S5\nexpect signal S3 automatic\n", scheme)
    assert len(result.failures) == 1


def test_a_train_standing_on_the_route_holds_the_signal_at_danger(scheme):
    result = run(
        "at 0 train 1A05 on E3 at 100 length 80 speed 0\n"
        'expect route "S3(M)" is occupied\n'
        "expect signal S3 shows R\n",
        scheme,
        until=10,
    )
    assert result.passed, result.failures


def test_a_train_running_out_of_the_section_gives_the_route_back(scheme):
    result = run(
        "at 0 train 1A05 on E3 at 1300 length 40 speed 25\n"
        "at 90 remove 1A05\n"
        'expect route "S3(M)" is set\n',
        scheme,
        until=120,
    )
    assert result.passed, result.failures


@pytest.fixture
def run_through():
    scheme = scheme_from_text(RUN)
    return Machine(scheme, build_interlocking(scheme))


def test_a_string_of_automatic_signals_is_all_set(run_through):
    assert status(run_through, "S3(M)") is RouteStatus.SET
    assert status(run_through, "S5(M)") is RouteStatus.SET


def test_they_step_up_behind_each_other(run_through):
    assert run_through.showing("S5").is_proceed
    assert run_through.showing("S3") is Aspect.GREEN


def test_a_train_in_front_steps_the_one_behind_down(run_through):
    run_through.occupy("TD")
    assert run_through.showing("S5") is Aspect.RED
    assert run_through.showing("S3") is Aspect.YELLOW


def test_replacing_one_of_them_steps_the_other_down(run_through):
    run_through.replace("S5")
    assert run_through.showing("S5") is Aspect.RED
    assert run_through.showing("S3") is Aspect.YELLOW
    assert status(run_through, "S3(M)") is RouteStatus.SET


def test_giving_it_back_puts_the_pair_up_again(run_through):
    run_through.replace("S5")
    run_through.work_automatically("S5")
    assert run_through.showing("S5").is_proceed
    assert run_through.showing("S3") is Aspect.GREEN
