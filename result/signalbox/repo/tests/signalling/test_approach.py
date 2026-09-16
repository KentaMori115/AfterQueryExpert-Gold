import pytest

from signalbox.signalling.approach import (
    DEFAULT_RELEASE_DELAY,
    ApproachKind,
    ApproachLock,
    approach_lock_for,
    approach_sections,
    release_delay,
)
from signalbox.signalling.interlocking import build_interlocking
from signalbox.units import Distance, Speed


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


def test_the_sections_watched_run_back_to_the_signal_in_rear(kingsmoor):
    watched = approach_sections(kingsmoor, kingsmoor.signal("K3"))
    assert watched == ("TC", "TB", "TA")


def test_the_search_stops_at_the_scheme_boundary(kingsmoor):
    watched = approach_sections(kingsmoor, kingsmoor.signal("K1"))
    assert watched == ("TA",)


def test_the_search_can_be_cut_short(kingsmoor):
    watched = approach_sections(kingsmoor, kingsmoor.signal("K3"), search=Distance(10.0))
    assert watched == ("TC",)


def test_up_signals_look_back_the_other_way(kingsmoor):
    assert approach_sections(kingsmoor, kingsmoor.signal("K4")) == (
        "TM",
        "TN",
        "TP",
        "TQ",
        "TR",
    )


def test_the_delay_grows_with_line_speed():
    assert release_delay(Speed.from_mph(20)) == pytest.approx(DEFAULT_RELEASE_DELAY)
    assert release_delay(Speed.from_mph(90)) == pytest.approx(180.0)
    assert release_delay(None) == pytest.approx(DEFAULT_RELEASE_DELAY)
    assert release_delay(None, floor=90.0) == pytest.approx(90.0)


def test_a_main_route_gets_track_and_time_release(kingsmoor, lock):
    approach = approach_lock_for(kingsmoor, lock.plan("K1(M)"))
    assert approach.kind is ApproachKind.TRACK_AND_TIME
    assert approach.watched == ("TA",)
    assert approach.delay == pytest.approx(180.0)
    assert not approach.immediate


def test_a_shunt_route_is_released_at_once(kingsmoor, lock):
    approach = approach_lock_for(kingsmoor, lock.plan("K20(S)"))
    assert approach.kind is ApproachKind.NONE
    assert approach.immediate
    assert approach.describe() == "released as soon as the signal is replaced"


def test_kinds_know_whether_a_timer_is_wanted():
    assert ApproachKind.TRACK_AND_TIME.needs_timer
    assert ApproachKind.TIME_ONLY.needs_timer
    assert not ApproachKind.NONE.needs_timer


def test_approach_locks_print_what_they_watch():
    approach = ApproachLock("K1(M)", ApproachKind.TRACK_AND_TIME, ("TA",), 120.0)
    assert str(approach) == "K1(M): track and time on TA after 120s"
    bare = ApproachLock("K9(M)", ApproachKind.TIME_ONLY, (), 90.0)
    assert bare.describe() == "time only on no track after 90s"


def test_every_route_can_be_approach_locked(kingsmoor, lock):
    for plan in lock:
        approach = approach_lock_for(kingsmoor, plan)
        assert approach.route == plan.name
