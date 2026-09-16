import pytest

from signalbox.signalling.conflict import (
    Conflict,
    ConflictMatrix,
    Reason,
    build_matrix,
    conflicts_between,
)
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


@pytest.fixture
def matrix(lock):
    return build_matrix(lock)


def test_routes_from_the_same_signal_always_conflict(lock):
    found = conflicts_between(lock.plan("K3(MA)"), lock.plan("K3(MB)"))
    reasons = {c.reason for c in found}
    assert Reason.SAME_SIGNAL in reasons
    assert Reason.POINTS in reasons


def test_routes_sharing_track_conflict(lock):
    found = conflicts_between(lock.plan("K2(M)"), lock.plan("K8(M)"))
    track = [c for c in found if c.reason is Reason.TRACK]
    assert track and track[0].detail == "TM, TN, TP"


def test_a_route_does_not_conflict_with_itself(lock):
    assert conflicts_between(lock.plan("K1(M)"), lock.plan("K1(M)")) == []


def test_routes_on_opposite_sides_of_the_layout_are_free(lock):
    assert conflicts_between(lock.plan("K5(M)"), lock.plan("K6(M)")) == []


def test_an_overlap_against_an_opposing_route_conflicts(lock):
    found = conflicts_between(lock.plan("K2(M)"), lock.plan("K1(S)"))
    overlap = [c for c in found if c.reason is Reason.OVERLAP]
    assert overlap and overlap[0].detail == "TL-BA"


def test_a_following_route_may_take_the_overlap_over(lock):
    assert conflicts_between(lock.plan("K1(M)"), lock.plan("K3(MA)")) == []


def test_reason_knows_whether_it_can_be_worked_round():
    assert Reason.TRACK.is_absolute
    assert Reason.POINTS.is_absolute
    assert not Reason.OVERLAP.is_absolute
    assert not Reason.FLANK.is_absolute


def test_conflicts_print_readably():
    conflict = Conflict("K1(M)", "K3(MA)", Reason.TRACK, "TB")
    assert str(conflict) == "K1(M) against K3(MA): track (TB)"
    assert str(Conflict("A", "B", Reason.SAME_SIGNAL)) == "A against B: same signal"
    assert conflict.pair == ("K1(M)", "K3(MA)")


def test_the_matrix_is_symmetric(matrix):
    for conflict in matrix.conflicts:
        assert matrix.clashes(conflict.first, conflict.second)
        assert matrix.clashes(conflict.second, conflict.first)


def test_the_matrix_lists_what_a_route_locks_out(matrix):
    against = matrix.against("K3(MA)")
    assert "K3(MB)" in against
    assert "K3(MA)" not in against


def test_reasons_can_be_asked_for_a_pair(matrix):
    reasons = matrix.reasons("K3(MA)", "K3(MB)")
    assert {c.reason for c in reasons} >= {Reason.SAME_SIGNAL, Reason.POINTS}
    assert matrix.reasons("K5(M)", "K6(M)") == []


def test_free_with_returns_the_compatible_routes(matrix, lock):
    names = [plan.name for plan in lock]
    free = matrix.free_with("K5(M)", names)
    assert "K5(M)" not in free
    assert "K6(M)" in free


def test_an_empty_matrix_has_no_opinions():
    empty = ConflictMatrix([])
    assert len(empty) == 0
    assert empty.against("K1(M)") == []
    assert not empty.clashes("K1(M)", "K3(MA)")
