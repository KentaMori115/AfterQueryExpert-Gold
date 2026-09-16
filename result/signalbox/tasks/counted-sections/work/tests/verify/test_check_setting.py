import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import setting as _setting  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_every_kingsmoor_route_can_be_set(context):
    assert run(context, only=["setting-refused"]).clean


def test_every_kingsmoor_main_route_clears_its_signal(context):
    assert run(context, only=["setting-clears"]).clean


def test_the_machine_agrees_with_the_table(context):
    assert run(context, only=["setting-pairs"]).clean


def test_hand_points_lying_the_wrong_way_refuse_the_route():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points motor hand
    node B boundary
    node C boundary
    edge E1 from A to P1.toe length 800 speed 40 direction down
    edge E2 from P1.normal to B length 400 speed 40 direction down
    edge E3 from P1.reverse to C length 400 speed 40 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    signal S1 on E1 at 800 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["setting-refused"])
    assert [f.subject for f in report] == ["S1(MB)"]
    assert "hand worked" in report.findings[0].detail
    assert report.worst() is Severity.ERROR


def test_the_examples_can_all_be_worked():
    from pathlib import Path

    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    for plan in sorted(Path("examples").glob("*.sbx")):
        context = Context.build(build_scheme(load_path(plan)))
        assert run(context, only=["setting-refused"]).clean, plan.name


def test_the_pair_check_stops_after_enough_pairs(context):
    from signalbox.verify.checks.setting import PAIR_LIMIT

    assert PAIR_LIMIT > 0
    assert run(context, only=["setting-pairs"]).clean


def test_a_scheme_with_one_route_has_no_pairs_to_check():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 800 speed 40 direction down
    section TA over E1
    signal S1 on E1 at 400 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["setting-pairs"]).clean


def test_a_signal_held_at_danger_by_the_one_ahead_is_not_a_finding(context):
    from signalbox.signalling.interlocking import build_interlocking
    from signalbox.sim.machine import Machine

    # K8 is two aspect and reads to K4, so with K4 at danger it stays at danger.
    machine = Machine(context.scheme, build_interlocking(context.scheme))
    machine.request("K8(M)")
    machine.tick(60.0)
    assert not machine.showing("K8").is_proceed
    assert run(context, only=["setting-clears"]).clean


def test_clearing_the_road_lets_a_two_aspect_signal_clear(context):
    from signalbox.signalling.interlocking import build_interlocking
    from signalbox.sim.machine import Machine
    from signalbox.verify.checks.setting import _clear_the_road

    machine = Machine(context.scheme, build_interlocking(context.scheme))
    machine.request("K8(M)")
    assert not machine.showing("K8").is_proceed
    _clear_the_road(machine, "K4")
    machine.tick(60.0)
    assert machine.showing("K8").is_proceed


def test_clearing_the_road_stops_at_a_signal_it_has_seen(context):
    from signalbox.signalling.interlocking import build_interlocking
    from signalbox.sim.machine import Machine
    from signalbox.verify.checks.setting import _clear_the_road

    machine = Machine(context.scheme, build_interlocking(context.scheme))
    _clear_the_road(machine, "K1", depth=2)
    assert machine.state.held_routes()
