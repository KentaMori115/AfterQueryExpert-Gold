"""Turning a train round, which is most of what happens at a terminus."""

from __future__ import annotations

import pytest

from signalbox.layout.loader import load_path
from signalbox.sim.scenario import parse_scenario, run_scenario
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.graph import Sense
from signalbox.topology.position import Position
from signalbox.topology.scheme import build_scheme
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    return build_world(kingsmoor)


@pytest.fixture
def ferrybridge():
    return build_scheme(load_path("examples/ferrybridge-quay.sbx"))


def script(body, until=60, step=2):
    return parse_scenario(f"scenario x {{\n step {step}\n until {until}\n}}\n" + body)


def test_a_train_turns_round_where_it_stands(world):
    world.add(Train("1A05", Position("D1", Distance(300.0)), length=Distance(80.0)))
    assert world.reverse("1A05")
    assert world.train("1A05").front.sense is Sense.REVERSE


def test_the_front_becomes_the_back(world):
    world.add(Train("1A05", Position("D1", Distance(300.0)), length=Distance(80.0)))
    world.reverse("1A05")
    assert world.train("1A05").front.offset.metres == pytest.approx(220.0)


def test_a_reversed_train_is_at_a_stand(world):
    world.add(Train("1A05", Position("D1", Distance(300.0)), speed=Speed.from_mph(0)))
    world.reverse("1A05")
    assert not world.train("1A05").moving


def test_a_moving_train_will_not_reverse(world):
    world.add(Train("1A05", Position("D1", Distance(300.0)), speed=Speed.from_mph(20)))
    assert not world.reverse("1A05")
    assert world.log.mentioning("cannot reverse")


def test_a_train_that_is_not_there_will_not_reverse(world):
    assert not world.reverse("9Z99")


def test_the_reversal_is_in_the_log(world):
    world.add(Train("1A05", Position("D1", Distance(300.0))))
    world.reverse("1A05")
    assert world.log.mentioning("reverses")


def test_turning_round_without_the_graph_pivots_about_the_front():
    train = Train("1A05", Position("D1", Distance(300.0)))
    assert train.turned_round().front.offset.metres == 300.0


def test_a_scenario_can_reverse_a_train(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script(
            "at 0 train 1A05 on D1 at 300\n"
            "at 4 stop 1A05\n"
            "at 4 reverse 1A05\n"
            "expect train 1A05 facing backward\n",
            until=8,
        ),
    )
    assert result.passed, result.failures


def test_reversing_a_train_that_is_not_there_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 reverse 9Z99\n"))
    assert "no train called 9Z99 to reverse" in result.failures[0]


def test_reversing_nothing_at_all_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 reverse\n"))
    assert "expected: reverse TRAIN" in result.failures[0]


def test_a_scenario_can_stop_a_train(kingsmoor):
    result = run_scenario(
        kingsmoor,
        script("at 0 train 1A05 on D1 at 60 speed 30\nat 10 stop 1A05\n", until=20),
    )
    assert result.passed, result.failures
    assert result.world.log.mentioning("brought to a stand")


def test_stopping_a_train_that_is_not_there_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 stop 9Z99\n"))
    assert "no train called 9Z99 to stop" in result.failures[0]


def test_stopping_nothing_at_all_is_reported(kingsmoor):
    result = run_scenario(kingsmoor, script("at 0 stop\n"))
    assert "expected: stop TRAIN" in result.failures[0]


def test_the_wrong_facing_is_reported(kingsmoor):
    result = run_scenario(
        kingsmoor, script("at 0 train 1A05 on D1 at 300\nexpect train 1A05 facing backward\n")
    )
    assert "faces forward, expected backward" in result.failures[0]


def test_a_terminating_train_reverses_and_goes_back(ferrybridge):
    result = run_scenario(
        ferrybridge,
        script(
            "at 0 train 1A05 on PL1 at 100 facing forward\n"
            "at 4 stop 1A05\n"
            "at 4 reverse 1A05\n"
            'at 8 set "Q2(M)"\n'
            "expect train 1A05 facing backward\n",
            until=120,
        ),
    )
    assert result.passed, result.failures
