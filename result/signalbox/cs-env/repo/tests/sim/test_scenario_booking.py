from pathlib import Path

from signalbox.sim.scenario import parse_scenario, run_scenario

DATA = Path(__file__).parent.parent / "data"


def script(body, until=200, step=2):
    return parse_scenario(f"scenario x {{\n step {step}\n until {until}\n}}\n" + body)


def test_a_booked_train_gets_its_routes(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script(
            "at 0 train 1A05 on D1 at 60 speed 20\n"
            'at 0 book 1A05 "K1(M)"\n'
            'expect route "K1(M)" is occupied\n',
            until=100,
        ),
    )
    assert result.passed, result.failures
    assert result.ars.granted == 1


def test_booking_needs_a_route(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 book 1A05\n"))
    assert "expected: book TRAIN ROUTE" in result.failures[0]


def test_a_booked_train_runs_the_whole_way(kingsmoor):
    text = (DATA / "booked-through.sbs").read_text()
    result = run_scenario(kingsmoor, parse_scenario(text))
    assert result.passed, result.failures


def test_the_setting_is_recorded_in_the_log(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script('at 0 train 1A05 on D1 at 60 speed 20\nat 0 book 1A05 "K1(M)"\n', until=60),
    )
    assert result.world.log.mentioning("requested")


def test_an_unbooked_scenario_still_runs(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 train 1A05 on D1 at 60\n", until=20))
    assert result.passed
    assert result.ars.granted == 0
