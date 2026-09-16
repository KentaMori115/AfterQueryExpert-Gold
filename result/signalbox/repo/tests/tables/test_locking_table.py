import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.locking_table import (
    LOCKING_COLUMNS,
    LockingRow,
    build_locking_report,
)


@pytest.fixture
def report(kingsmoor):
    return build_locking_report(build_interlocking(kingsmoor))


def test_there_is_a_row_for_every_route(report, kingsmoor):
    assert len(report) == len(build_interlocking(kingsmoor))


def test_a_row_lists_what_the_route_holds(report):
    row = report.row("K1(M)")
    assert row.holds == ("TB-AB", "TC-AB")
    assert row.overlap == ("TD-AB", "TE-AB")


def test_the_release_order_is_the_train_order(report):
    assert report.row("K1(M)").releases[0] == "TB-AB"


def test_long_routes_release_sectionally(report):
    assert report.row("K1(M)").is_sectional
    assert report.row("K1(M)") in report.sectional()


def test_a_short_route_releases_complete(report):
    assert report.row("K5(M)").release == "complete"


def test_what_a_route_locks_out_is_listed(report):
    assert "K3(MB)" in report.row("K3(MA)").locks_out


def test_routes_holding_the_same_track_the_other_way_are_listed(report):
    row = report.row("K1(S)")
    assert isinstance(row.held_by, tuple)


def test_holders_of_a_subroute_can_be_found(report):
    assert "K1(M)" in report.holders_of("TB-AB")
    assert report.holders_of("TZ-AB") == []


def test_every_column_renders(report):
    row = report.row("K1(M)")
    for column in LOCKING_COLUMNS:
        assert isinstance(row.cell(column), str)


def test_rows_print_what_they_hold():
    row = LockingRow("K1(M)", ("TB-AB",), (), "sectional", ("TB-AB",), (), ())
    assert str(row) == "K1(M): TB-AB"
    assert str(LockingRow("K9(M)", (), (), "complete", (), (), ())) == "K9(M): nothing"


def test_the_report_keeps_its_working(report):
    assert report.matrix.against("K3(MA)")
    assert report.table.entry("K1(M)").route == "K1(M)"
