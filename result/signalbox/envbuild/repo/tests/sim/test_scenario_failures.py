from pathlib import Path

from signalbox.sim.scenario import parse_scenario, run_scenario

DATA = Path(__file__).parent.parent / "data"


def script(body, until=100, step=2):
    return parse_scenario(f"scenario x {{\n step {step}\n until {until}\n}}\n" + body)


def test_points_can_be_failed(kingsmoor):
    result = run_scenario(
        kingsmoor, script("at 0 fail P101\nexpect points P101 status failed\n")
    )
    assert result.passed, result.failures


def test_points_can_be_restored(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script("at 0 fail P101\nat 10 restore P101\nexpect points P101 status detected\n"),
    )
    assert result.passed, result.failures


def test_a_route_can_be_emergency_released(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script(
            'at 0 set "K1(M)"\nat 10 release "K1(M)"\nexpect route "K1(M)" is releasing\n',
            until=20,
        ),
    )
    assert result.passed, result.failures


def test_the_release_finishes_once_the_timer_runs_out(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script(
            'at 0 set "K1(M)"\nat 10 release "K1(M)"\nexpect route "K1(M)" is available\n',
            until=600,
        ),
    )
    assert result.passed, result.failures


def test_releasing_a_route_that_is_not_set_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script('at 0 release "K1(M)"\n'))
    assert "could not release" in result.failures[0]


def test_the_lie_of_the_points_can_be_expected(kingsmoor):
    result = run_scenario(
        kingsmoor, script('at 0 set "K3(MB)"\nexpect points P101 lying reverse\n', until=30)
    )
    assert result.passed, result.failures


def test_a_wrong_lie_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("expect points P101 lying reverse\n"))
    assert "lies normal, expected reverse" in result.failures[0]


def test_a_wrong_route_status_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script('expect route "K1(M)" is set\n'))
    assert "is available, expected set" in result.failures[0]


def test_the_failure_scenario_beside_the_plan_passes(kingsmoor):
    text = (DATA / "points-failure.sbs").read_text()
    result = run_scenario(kingsmoor, parse_scenario(text))
    assert result.passed, result.failures
