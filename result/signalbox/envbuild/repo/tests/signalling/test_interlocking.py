import pytest

from signalbox.errors import InterlockingError
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.route import RouteClass
from signalbox.topology.graph import Lie
from signalbox.units import Distance


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


def test_every_route_gets_a_plan(lock):
    assert len(lock) == 12
    assert "K1(M)" in lock
    assert [plan.name for plan in lock][:3] == ["K1(M)", "K1(S)", "K2(M)"]


def test_the_interlocking_describes_itself(lock):
    assert lock.describe() == "12 routes, 1 with a swinging overlap, over 20 sections"


def test_a_plan_carries_route_overlap_and_flanks(lock):
    plan = lock.plan("K1(M)")
    assert plan.entrance == "K1"
    assert plan.exit == "K3"
    assert plan.klass is RouteClass.MAIN
    assert plan.sections == ("TB", "TC")
    assert plan.swinging_overlap
    assert plan.flanks


def test_the_preferred_overlap_is_the_plans_overlap(lock):
    plan = lock.plan("K1(M)")
    assert plan.overlap is plan.overlaps[0]
    assert plan.overlap_points() == {"P101": Lie.NORMAL}


def test_overlap_sections_exclude_the_routes_own(lock):
    plan = lock.plan("K1(M)")
    assert "TC" not in plan.overlap_sections()
    assert set(plan.overlap_sections()) == {"TD", "TE", "TG"}


def test_a_plan_without_an_overlap_says_so(lock):
    plan = lock.plan("K5(M)")
    assert plan.overlap is None
    assert plan.overlap_points() == {}
    assert not plan.swinging_overlap


def test_flank_points_and_held_signals_are_collected(lock):
    plan = lock.plan("K1(M)")
    assert plan.flank_points() == {"P104": Lie.NORMAL}
    assert lock.plan("K2(M)").signals_held() == ("K22", "K8")


def test_unprotected_flanks_are_reachable(lock):
    assert lock.plan("K3(MA)").unprotected_flanks()
    assert not lock.plan("K2(M)").unprotected_flanks()


def test_routes_can_be_found_by_signal(lock):
    assert [p.name for p in lock.from_signal("K3")] == ["K3(MA)", "K3(MB)"]
    assert [p.name for p in lock.to_signal("K3")] == ["K1(M)"]


def test_routes_can_be_found_by_section(lock):
    over_td = {p.name for p in lock.over_section("TD")}
    assert "K1(M)" in over_td
    assert "K3(MA)" in over_td
    assert lock.over_section("TZ") == []


def test_unknown_route_is_reported(lock):
    with pytest.raises(InterlockingError, match="no route called K9"):
        lock.plan("K9")


def test_a_shorter_overlap_changes_what_is_held(kingsmoor):
    tight = build_interlocking(kingsmoor, overlap=Distance(40.0))
    assert not tight.plan("K1(M)").swinging_overlap


def test_plan_prints_its_route_and_exit(lock):
    assert str(lock.plan("K20(S)")) == "K20(S) to BAY (buffer)"
