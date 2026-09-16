import pytest

from signalbox.signalling.conflict import build_matrix
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.locking import (
    LockingEntry,
    Release,
    build_locking,
    locking_for,
)
from signalbox.signalling.subroute import Subroute
from signalbox.topology.graph import Lie


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


@pytest.fixture
def table(lock):
    return build_locking(lock, build_matrix(lock))


def test_subroutes_name_the_section_and_the_direction():
    sub = Subroute("TB", "AB")
    assert sub.name == "TB-AB"
    assert str(sub) == "TB-AB"
    assert sub.reverse.name == "TB-BA"
    assert sub.opposes(sub.reverse)
    assert not sub.opposes(sub)


def test_a_down_route_locks_its_sections_in_the_ab_direction(table):
    entry = table.entry("K1(M)")
    assert [s.name for s in entry.subroutes] == ["TB-AB", "TC-AB"]


def test_an_up_route_locks_the_same_sections_the_other_way(table):
    entry = table.entry("K2(M)")
    assert [s.name for s in entry.subroutes] == ["TQ-BA", "TP-BA", "TN-BA", "TM-BA"]


def test_the_overlap_is_held_as_extra_subroutes(table):
    entry = table.entry("K1(M)")
    assert [s.name for s in entry.overlap_subroutes] == ["TD-AB", "TE-AB"]
    assert entry.held_track()[-1].name == "TE-AB"


def test_points_locked_include_route_overlap_and_flank(table):
    entry = table.entry("K1(M)")
    assert entry.locks("P103") is Lie.NORMAL
    assert entry.locks("P101") is Lie.NORMAL
    assert entry.locks("P104") is Lie.NORMAL
    assert entry.locks("P102") is None


def test_a_route_locks_out_everything_it_conflicts_with(table):
    assert "K3(MB)" in table.entry("K3(MA)").locks_out
    assert "K3(MA)" not in table.entry("K1(M)").locks_out


def test_long_routes_release_sectionally(table):
    assert table.entry("K1(M)").release is Release.SECTIONAL
    assert table.entry("K1(M)").is_sectional


def test_a_single_section_route_releases_complete(table):
    assert table.entry("K5(M)").release is Release.COMPLETE
    assert str(Release.COMPLETE) == "complete"


def test_sectional_release_can_be_turned_off(lock):
    table = build_locking(lock, build_matrix(lock), sectional_release=False)
    assert all(entry.release is Release.COMPLETE for entry in table)


def test_release_order_follows_the_train(table):
    order = [s.name for s in table.entry("K1(M)").releases_in_order()]
    assert order == ["TB-AB", "TC-AB", "TD-AB", "TE-AB"]


def test_the_table_finds_who_holds_a_subroute(table):
    holders = table.holders_of(Subroute("TB", "AB"))
    assert "K1(M)" in holders
    assert table.holders_of(Subroute("TZ", "AB")) == []


def test_opposing_holders_are_the_other_direction(table):
    assert table.opposing_holders(Subroute("TN", "AB")) == table.holders_of(
        Subroute("TN", "BA")
    )


def test_every_route_has_an_entry(table, lock):
    assert len(table) == len(lock)


def test_entries_print_their_track():
    entry = LockingEntry("K1(M)", subroutes=(Subroute("TA", "AB"),))
    assert str(entry) == "K1(M): TA-AB"
    assert str(LockingEntry("K9(M)")) == "K9(M): none"


def test_locking_for_one_route_directly(kingsmoor, lock):
    matrix = build_matrix(lock)
    entry = locking_for(kingsmoor, lock.plan("K8(M)"), matrix)
    assert entry.route == "K8(M)"
    assert [s.name for s in entry.subroutes] == ["TS-BA", "TP-BA", "TN-BA", "TM-BA"]
