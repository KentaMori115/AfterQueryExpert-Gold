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


def test_a_signal_can_lose_its_lamps(machine):
    assert machine.fail_signal("K1")
    assert machine.state.is_dark("K1")


def test_a_dark_signal_shows_nothing_a_driver_can_act_on(machine):
    machine.request("K1(M)")
    machine.tick(10.0)
    assert machine.showing("K1") is Aspect.YELLOW
    machine.fail_signal("K1")
    assert machine.showing("K1") is Aspect.RED


def test_a_dark_signal_holds_the_one_behind_it_down(machine):
    for route in ("K1(M)", "K3(MA)", "K5(M)"):
        machine.request(route)
    machine.tick(30.0)
    assert machine.showing("K1") is Aspect.GREEN
    machine.fail_signal("K5")
    assert machine.showing("K3") is Aspect.YELLOW
    assert machine.showing("K1") is Aspect.DOUBLE_YELLOW


def test_relighting_puts_things_back(machine):
    machine.request("K1(M)")
    machine.tick(10.0)
    machine.fail_signal("K1")
    machine.relight_signal("K1")
    assert not machine.state.is_dark("K1")
    assert machine.showing("K1") is Aspect.YELLOW


def test_a_signal_that_is_not_there_cannot_be_failed(machine):
    outcome = machine.fail_signal("K99")
    assert not outcome
    assert "no signal called K99" in outcome.reason


def test_a_signal_that_is_not_there_cannot_be_relit(machine):
    assert not machine.relight_signal("K99")


def test_the_state_says_how_many_are_out(machine):
    machine.fail_signal("K1")
    assert "1 dark" in machine.state.describe()


def test_a_scenario_can_put_a_signal_out(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 fail K1\nexpect signal K1 dark\n"))
    assert result.passed, result.failures


def test_a_scenario_can_relight_it(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script("at 0 fail K1\nat 10 restore K1\nexpect signal K1 shows R\n"),
    )
    assert result.passed, result.failures


def test_expecting_darkness_that_is_not_there_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("expect signal K1 dark\n"))
    assert "K1 is lit" in result.failures[0]


def test_a_train_stops_at_a_dark_signal(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script(
            "at 0 train 1A05 on D1 at 60 speed 20\n"
            'at 0 set "K1(M)"\n'
            "at 2 fail K1\n"
            "expect train 1A05 on D1\n",
            until=200,
        ),
    )
    assert result.passed, result.failures
