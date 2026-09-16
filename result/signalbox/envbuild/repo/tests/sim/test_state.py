import pytest

from signalbox.errors import InterlockingError
from signalbox.signalling.signal import Aspect
from signalbox.signalling.subroute import Subroute
from signalbox.sim.state import (
    PointState,
    PointStatus,
    RouteState,
    RouteStatus,
    SchemeState,
)
from signalbox.topology.graph import Lie


def test_points_start_normal_and_detected():
    points = PointState("P101")
    assert points.lie is Lie.NORMAL
    assert points.detected
    assert points.lying(Lie.NORMAL)
    assert not points.lying(Lie.REVERSE)
    assert str(points) == "P101 normal (detected)"


def test_points_lose_detection_while_moving():
    points = PointState("P101")
    points.start_moving(Lie.REVERSE, 6.0)
    assert points.status is PointStatus.MOVING
    assert not points.detected
    assert not points.lying(Lie.NORMAL)
    assert str(points) == "P101 moving to reverse"


def test_points_take_up_their_new_position_when_they_finish():
    points = PointState("P101")
    points.start_moving(Lie.REVERSE, 6.0)
    points.finish()
    assert points.lie is Lie.REVERSE
    assert points.detected
    assert points.moving_to is None


def test_failed_points_are_not_usable():
    points = PointState("P101")
    points.start_moving(Lie.REVERSE, 6.0)
    points.fail()
    assert points.status is PointStatus.FAILED
    assert not points.detected
    assert points.remaining == 0.0


def test_finishing_points_that_were_not_moving_leaves_them_alone():
    points = PointState("P101", lie=Lie.REVERSE)
    points.finish()
    assert points.lie is Lie.REVERSE


def test_route_statuses_know_when_track_is_held():
    assert RouteStatus.SET.is_held
    assert RouteStatus.OCCUPIED.is_held
    assert RouteStatus.RELEASING.is_held
    assert not RouteStatus.AVAILABLE.is_held
    assert not RouteStatus.CALLED.is_held


def test_route_state_prints_its_status():
    state = RouteState("K1(M)", RouteStatus.SET, set_at=12.0)
    assert str(state) == "K1(M) set"
    assert state.held


def test_track_occupancy():
    state = SchemeState()
    state.occupy("TA")
    assert state.is_occupied("TA")
    assert not state.all_clear(("TA", "TB"))
    assert state.all_clear(("TB", "TC"))
    state.clear("TA")
    assert state.all_clear(("TA",))


def test_clearing_track_that_was_never_occupied_is_harmless():
    state = SchemeState()
    state.clear("TA")
    assert not state.occupied


def test_points_and_routes_are_looked_up_by_name():
    state = SchemeState(
        points={"P101": PointState("P101")}, routes={"K1(M)": RouteState("K1(M)")}
    )
    assert state.point("P101").name == "P101"
    assert state.route("K1(M)").name == "K1(M)"
    with pytest.raises(InterlockingError, match="no points called P9"):
        state.point("P9")
    with pytest.raises(InterlockingError, match="no route called K9"):
        state.route("K9")


def test_lying_asks_the_points():
    state = SchemeState(points={"P101": PointState("P101", lie=Lie.REVERSE)})
    assert state.lying("P101", Lie.REVERSE)
    assert not state.lying("P101", Lie.NORMAL)


def test_moving_points_are_listed():
    state = SchemeState(points={"P101": PointState("P101"), "P102": PointState("P102")})
    state.point("P101").start_moving(Lie.REVERSE, 6.0)
    assert [p.name for p in state.moving_points()] == ["P101"]


def test_subroutes_are_held_by_one_route_at_a_time():
    state = SchemeState()
    sub = Subroute("TA", "AB")
    state.lock(sub, "K1(M)")
    assert state.holder_of(sub) == "K1(M)"
    assert state.locked_against(sub.reverse) == "K1(M)"
    assert state.locked_against(sub) is None
    state.free(sub)
    assert state.holder_of(sub) is None


def test_held_routes_are_the_ones_holding_track():
    state = SchemeState(
        routes={
            "K1(M)": RouteState("K1(M)", RouteStatus.SET),
            "K3(MA)": RouteState("K3(MA)", RouteStatus.AVAILABLE),
        }
    )
    assert [r.name for r in state.held_routes()] == ["K1(M)"]


def test_the_state_describes_itself():
    state = SchemeState(clock=42.0)
    state.occupy("TA")
    state.routes["K1(M)"] = RouteState("K1(M)", RouteStatus.SET)
    assert state.describe() == "t=42s 1 sections occupied, 1 routes held"


def test_aspects_are_just_a_mapping():
    state = SchemeState()
    state.aspects["K1"] = Aspect.YELLOW
    assert state.aspects["K1"] is Aspect.YELLOW


def test_holds_know_whether_they_are_only_an_overlap():
    from signalbox.sim.state import Hold

    assert not Hold("K1(M)").is_overlap
    assert Hold("K1(M)", overlap=True).is_overlap
    assert str(Hold("K1(M)")) == "K1(M)"
    assert str(Hold("K1(M)", overlap=True)) == "K1(M) (overlap)"


def test_a_route_hold_blocks_another_route():
    state = SchemeState()
    sub = Subroute("TD", "AB")
    state.lock(sub, "K1(M)")
    assert state.blocker_of(sub, "K3(MA)") == "K1(M)"
    assert state.blocker_of(sub, "K1(M)") is None


def test_an_overlap_hold_can_be_taken_over_the_same_way():
    state = SchemeState()
    sub = Subroute("TD", "AB")
    state.lock(sub, "K1(M)", overlap=True)
    assert state.blocker_of(sub, "K3(MA)") is None
    assert state.hold_on(sub).is_overlap


def test_an_overlap_hold_still_blocks_the_other_direction():
    state = SchemeState()
    state.lock(Subroute("TD", "AB"), "K1(M)", overlap=True)
    assert state.blocker_of(Subroute("TD", "BA"), "K9(M)") == "K1(M)"


def test_free_track_blocks_nobody():
    state = SchemeState()
    assert state.blocker_of(Subroute("TD", "AB"), "K3(MA)") is None


def test_what_a_route_is_holding_can_be_listed():
    state = SchemeState()
    state.lock(Subroute("TB", "AB"), "K1(M)")
    state.lock(Subroute("TD", "AB"), "K1(M)", overlap=True)
    state.lock(Subroute("TN", "BA"), "K2(M)")
    assert state.held_by("K1(M)") == ["TB-AB", "TD-AB"]
