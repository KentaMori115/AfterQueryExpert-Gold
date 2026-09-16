"""The terminus example, which exercises the parts a through station does not.

Everything at Ferrybridge is bidirectional, every platform ends at a buffer
stop, and every move out is a reversal of a move in. That combination breaks
assumptions that a plain double track layout never gets near.
"""

from __future__ import annotations

import pytest

from signalbox.layout.loader import load_path
from signalbox.signalling.interlocking import build_interlocking
from signalbox.sim.machine import Machine
from signalbox.topology.reachability import dead_ends, unreachable_edges
from signalbox.topology.scheme import build_scheme
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.rules import Context, run


@pytest.fixture
def ferrybridge():
    return build_scheme(load_path("examples/ferrybridge-quay.sbx"))


@pytest.fixture
def lock(ferrybridge):
    return build_interlocking(ferrybridge)


def test_the_scheme_is_the_shape_we_drew(ferrybridge):
    assert ferrybridge.describe() == (
        "Ferrybridge Quay: 11 nodes, 10 edges, 10 sections, 6 signals"
    )


def test_the_reduced_overlap_is_used(ferrybridge):
    assert ferrybridge.standards.overlap.metres == 46.0
    assert ferrybridge.standards.approach == 90.0


def test_arrivals_run_into_every_platform(lock):
    into_platforms = {plan.exit for plan in lock if plan.route.exit.kind.value == "buffer"}
    assert into_platforms == {"BUF1", "BUF2", "BUF3"}


def test_departures_all_come_back_to_the_same_signal(lock):
    departures = [plan for plan in lock if plan.exit == "Q8"]
    assert {plan.entrance for plan in departures} == {"Q2", "Q4", "Q6"}


def test_an_arrival_and_a_departure_conflict(lock):
    from signalbox.signalling.conflict import conflicts_between

    assert conflicts_between(lock.plan("Q1(MB)"), lock.plan("Q2(M)"))


def test_two_departures_from_different_platforms_conflict(lock):
    from signalbox.signalling.conflict import conflicts_between

    assert conflicts_between(lock.plan("Q2(M)"), lock.plan("Q4(M)"))


def test_the_platforms_are_not_dead_ends(ferrybridge):
    assert dead_ends(ferrybridge) == []


def test_every_platform_can_be_reached(ferrybridge):
    assert unreachable_edges(ferrybridge) == []


def test_the_trap_protects_the_third_platform(lock):
    from signalbox.signalling.flank import FlankKind

    kinds = {flank.kind for plan in lock for flank in plan.flanks if flank.node == "P301"}
    assert FlankKind.TRAP in kinds or FlankKind.DEAD_END in kinds


def test_an_arrival_can_be_set_and_cleared(ferrybridge, lock):
    machine = Machine(ferrybridge, lock)
    assert machine.request("Q3(MA)")
    machine.tick(30.0)
    assert machine.showing("Q3").is_proceed


def test_a_departure_cannot_be_set_against_an_arrival(ferrybridge, lock):
    machine = Machine(ferrybridge, lock)
    assert machine.request("Q1(MB)")
    machine.tick(30.0)
    assert not machine.request("Q2(M)")


def test_the_scheme_has_no_errors_worth_stopping_for(ferrybridge):
    report = run(Context.build(ferrybridge))
    assert not report.by_rule("layout-stranded")
    assert not report.by_rule("setting-refused")
    assert not report.by_rule("locking-headon")
