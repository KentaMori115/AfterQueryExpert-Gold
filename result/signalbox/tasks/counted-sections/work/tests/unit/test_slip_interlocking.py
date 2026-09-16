"""A slip has to be called by the interlocking the same way points are."""

from __future__ import annotations

import pytest

from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.signalling.interlocking import build_interlocking
from signalbox.sim.machine import Machine
from signalbox.tables.points_table import build_points_table
from signalbox.topology.graph import Lie
from signalbox.topology.scheme import build_scheme

PLAN = """
node A boundary
node B boundary
node C boundary
node D boundary
node X slip double yes throw 9
edge E1 from A to X.a1 length 400 speed 25 direction bidirectional
edge E2 from X.a2 to B length 400 speed 25 direction bidirectional
edge E3 from C to X.b1 length 400 speed 25 direction bidirectional
edge E4 from X.b2 to D length 400 speed 25 direction bidirectional
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 400 facing forward direction down
signal S3 on E3 at 400 facing forward direction down
"""


@pytest.fixture
def scheme():
    parsed = parse(PLAN)
    validate(parsed)
    return build_scheme(parsed)


@pytest.fixture
def lock(scheme):
    return build_interlocking(scheme)


def test_a_slip_gives_a_signal_two_routes(lock):
    from_s1 = [plan.name for plan in lock.from_signal("S1")]
    assert len(from_s1) == 2


def test_the_two_routes_call_the_slip_opposite_ways(lock):
    lies = {plan.name: plan.points().get("X") for plan in lock.from_signal("S1")}
    assert set(lies.values()) == {Lie.NORMAL, Lie.REVERSE}


def test_the_slip_appears_in_the_points_table(scheme, lock):
    table = build_points_table(scheme, lock)
    assert [row.points for row in table] == ["X"]
    assert table.row("X").routes


def test_the_slip_has_a_machine_with_its_throw_time(scheme):
    assert scheme.machine("X").throw == 9.0


def test_the_machine_moves_the_slip(scheme, lock):
    machine = Machine(scheme, lock)
    reverse = next(
        plan.name for plan in lock.from_signal("S1") if plan.points().get("X") is Lie.REVERSE
    )
    assert machine.request(reverse)
    machine.tick(20.0)
    assert machine.lie_of("X") is Lie.REVERSE


def test_the_two_routes_over_the_slip_conflict(lock):
    from signalbox.signalling.conflict import conflicts_between

    first, second = lock.from_signal("S1")
    assert conflicts_between(first, second)


def test_a_single_slip_will_not_join_the_second_pair():
    from signalbox.topology.graph import Sense

    text = PLAN.replace("slip double yes throw 9", "slip throw 9")
    parsed = parse(text)
    validate(parsed)
    graph = build_scheme(parsed).graph
    assert graph.step("E2", Sense.REVERSE, Lie.REVERSE) == []
