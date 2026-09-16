import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.sim.machine import Machine
from signalbox.sim.scenario import parse_scenario, run_scenario


@pytest.fixture
def machine(kingsmoor):
    return Machine(kingsmoor, build_interlocking(kingsmoor))


def script(body, until=60, step=2):
    return parse_scenario(f"scenario x {{\n step {step}\n until {until}\n}}\n" + body)


def test_a_failed_track_circuit_reads_occupied(machine):
    assert not machine.state.is_occupied("TB")
    machine.fail_section("TB")
    assert machine.state.is_occupied("TB")
    assert machine.state.has_failed("TB")


def test_a_failed_track_circuit_refuses_the_route(machine):
    machine.fail_section("TB")
    outcome = machine.request("K1(M)")
    assert not outcome
    assert "TB is occupied" in outcome.reason


def test_failing_under_a_set_route_names_it(machine):
    machine.request("K1(M)")
    machine.tick(10.0)
    outcome = machine.fail_section("TC")
    assert "failed under K1(M)" in outcome.reason


def test_a_failure_under_a_set_route_puts_the_signal_back(machine):
    machine.request("K1(M)")
    machine.tick(10.0)
    assert machine.showing("K1") is Aspect.YELLOW
    machine.fail_section("TC")
    assert machine.showing("K1") is Aspect.RED


def test_restoring_the_circuit_puts_things_right(machine):
    machine.request("K1(M)")
    machine.tick(10.0)
    machine.fail_section("TC")
    machine.restore_section("TC")
    assert not machine.state.has_failed("TC")
    assert machine.showing("K1") is Aspect.YELLOW


def test_failing_a_circuit_nothing_is_using_says_so(machine):
    assert machine.fail_section("TL").reason == "TL failed"


def test_the_state_says_how_many_have_failed(machine):
    machine.fail_section("TB")
    assert "1 failed" in machine.state.describe()


def test_a_scenario_can_fail_a_track_circuit(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 fail TB\nexpect section TB failed\n"))
    assert result.passed, result.failures


def test_a_scenario_can_restore_a_track_circuit(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script("at 0 fail TB\nat 10 restore TB\nexpect section TB clear\n"),
    )
    assert result.passed, result.failures


def test_a_failed_circuit_reads_occupied_in_a_scenario(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 fail TB\nexpect section TB occupied\n"))
    assert result.passed, result.failures


def test_expecting_a_failure_that_did_not_happen_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("expect section TB failed\n"))
    assert "has not failed" in result.failures[0]


def test_failing_something_that_is_not_there_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 fail wibble\n"))
    assert "nothing called wibble to fail" in result.failures[0]


def test_restoring_something_that_is_not_there_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 restore wibble\n"))
    assert "nothing called wibble to restore" in result.failures[0]


def test_points_can_still_be_failed_by_name(kingsmoor):
    result = run_scenario(
        kingsmoor, script("at 0 fail P101\nexpect points P101 status failed\n")
    )
    assert result.passed, result.failures
