"""Every scenario shipped with the examples has to pass.

They are documentation as much as tests: somebody reading them should be able to
see what a scenario file looks like and trust that it does what it says.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.layout.loader import load_path
from signalbox.sim.scenario import parse_scenario, run_scenario
from signalbox.topology.scheme import build_scheme

ROOT = Path(__file__).parent.parent
SCENARIOS = sorted((ROOT / "examples" / "scenarios").glob("*.sbs"))

#: Which plan each scenario is written against, by the first word of its name.
PLANS = {
    "ashcombe": ROOT / "examples" / "ashcombe.sbx",
    "kingsmoor": ROOT / "tests" / "data" / "kingsmoor.sbx",
}


def plan_for(script: Path) -> Path:
    return PLANS[script.stem.split("-")[0]]


@pytest.fixture(params=SCENARIOS, ids=lambda path: path.stem)
def scenario(request):
    return request.param


def test_there_are_scenarios_to_run():
    assert SCENARIOS


def test_every_scenario_names_a_plan_we_have(scenario):
    assert plan_for(scenario).exists()


def test_every_scenario_parses(scenario):
    parsed = parse_scenario(scenario.read_text(), source=str(scenario))
    assert parsed.commands
    assert parsed.expectations


def test_every_scenario_passes(scenario):
    scheme = build_scheme(load_path(plan_for(scenario)))
    result = run_scenario(scheme, parse_scenario(scenario.read_text()))
    assert result.passed, result.failures


def test_every_scenario_moves_a_train(scenario):
    scheme = build_scheme(load_path(plan_for(scenario)))
    result = run_scenario(scheme, parse_scenario(scenario.read_text()))
    assert result.world.history
    assert result.world.history.trains()


def test_two_trains_pass_each_other_at_ashcombe():
    script = ROOT / "examples" / "scenarios" / "ashcombe-both-ways.sbs"
    scheme = build_scheme(load_path(PLANS["ashcombe"]))
    result = run_scenario(scheme, parse_scenario(script.read_text()))
    assert result.passed, result.failures
    assert sorted(result.world.history.trains()) == ["1A05", "2B10"]
    assert result.world.trains == {}


def test_the_branch_scenario_recovers_from_the_failure():
    script = ROOT / "examples" / "scenarios" / "kingsmoor-branch.sbs"
    scheme = build_scheme(load_path(PLANS["kingsmoor"]))
    result = run_scenario(scheme, parse_scenario(script.read_text()))
    assert result.passed, result.failures
    assert result.world.log.about("P103")
