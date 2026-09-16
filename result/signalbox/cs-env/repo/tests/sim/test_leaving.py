"""A train that reaches the edge of the scheme has gone, not stopped.

The alternative is a train standing on the last section for ever, holding a
route that will never release, which is a simulation artefact rather than
anything a railway does.
"""

from __future__ import annotations

import pytest

from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    return build_world(kingsmoor)


def run(world, seconds=400.0, step=2.0):
    for _ in range(int(seconds / step)):
        world.step(step)


def test_a_train_reaching_the_boundary_leaves(world):
    world.add(Train("1A05", Position("D6", Distance(10.0)), speed=Speed.from_mph(30)))
    run(world, seconds=60.0)
    assert "1A05" not in world.trains
    assert world.log.mentioning("leaves")


def test_the_track_it_was_on_is_given_up(world):
    world.add(Train("1A05", Position("D6", Distance(10.0)), speed=Speed.from_mph(30)))
    run(world, seconds=60.0)
    assert "TF" not in world.occupancy()


def test_a_train_reaching_a_buffer_stops_and_stays(world):
    world.add(Train("1A05", Position("BE", Distance(10.0)), speed=Speed.from_mph(10)))
    run(world, seconds=120.0)
    assert "1A05" in world.trains
    assert not world.train("1A05").moving


def test_the_buffer_is_reported_rather_than_the_train_vanishing(world):
    world.add(Train("1A05", Position("BE", Distance(10.0)), speed=Speed.from_mph(10)))
    run(world, seconds=120.0)
    assert world.log.mentioning("runs out of track")


def test_a_train_that_leaves_gives_up_the_track_it_held(world):
    world.request("K5(M)")
    world.machine.tick(10.0)
    world.add(Train("1A05", Position("D5", Distance(500.0)), speed=Speed.from_mph(30)))
    run(world, seconds=200.0)
    assert "1A05" not in world.trains
    assert world.occupancy() == set()


def test_a_train_that_has_gone_can_be_removed_again(world):
    world.add(Train("1A05", Position("D6", Distance(10.0)), speed=Speed.from_mph(30)))
    run(world, seconds=60.0)
    world.remove("1A05")
    assert "1A05" not in world.trains


def test_the_history_stops_when_the_train_goes(world):
    world.add(Train("1A05", Position("D6", Distance(10.0)), speed=Speed.from_mph(30)))
    run(world, seconds=60.0)
    fixes = world.history.of("1A05")
    assert fixes
    assert fixes[-1].at < world.clock


def test_a_scenario_can_expect_a_train_to_have_gone(kingsmoor):
    from signalbox.sim.scenario import parse_scenario, run_scenario

    scenario = parse_scenario(
        "scenario x {\n step 2\n until 60\n}\n"
        "at 0 train 1A05 on D6 at 10 speed 30\n"
        "expect train 1A05 gone\n"
    )
    assert run_scenario(kingsmoor, scenario).passed


def test_a_train_that_is_still_there_is_reported(kingsmoor):
    from signalbox.sim.scenario import parse_scenario, run_scenario

    scenario = parse_scenario(
        "scenario x {\n step 2\n until 4\n}\n"
        "at 0 train 1A05 on D1 at 10\n"
        "expect train 1A05 gone\n"
    )
    result = run_scenario(kingsmoor, scenario)
    assert "still on D1" in result.failures[0]
