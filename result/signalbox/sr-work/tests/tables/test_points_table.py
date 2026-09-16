import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.points_table import POINT_COLUMNS, PointsRow, build_points_table


@pytest.fixture
def table(kingsmoor):
    return build_points_table(kingsmoor, build_interlocking(kingsmoor))


def test_there_is_a_row_for_every_set_of_points(table):
    assert [row.points for row in table] == ["P101", "P102", "P103", "P104", "P105"]
    assert len(table) == 5


def test_routes_are_listed_by_the_way_they_call_the_points(table):
    row = table.row("P101")
    assert "K3(MA)" in row.normal_for
    assert "K3(MB)" in row.reverse_for
    assert row.routes == ("K3(MA)", "K3(MB)")


def test_facing_moves_are_picked_out(table):
    assert "K3(MA)" in table.row("P101").facing_for
    assert table.row("P101").is_facing
    assert table.row("P101").needs_a_lock


def test_a_trailing_only_set_of_points_needs_no_lock(table):
    row = table.row("P102")
    assert row.facing_for == ()
    assert not row.needs_a_lock


def test_flank_and_overlap_duties_are_recorded(table):
    assert "K1(M)" in table.row("P104").flank_for
    assert "K1(M)" in table.row("P101").overlap_for


def test_the_facing_list_is_the_rows_that_carry_locks(table):
    assert {row.points for row in table.facing()} >= {"P101"}


def test_points_nothing_uses_are_reported():
    from signalbox.topology.scheme import scheme_from_text

    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B buffer
    node C boundary
    edge E1 from A to P1.toe length 100
    edge E2 from P1.normal to C length 100
    edge E3 from P1.reverse to B length 100
    """)
    table = build_points_table(scheme, build_interlocking(scheme))
    assert [row.points for row in table.unused()] == ["P1"]


def test_every_column_renders(table):
    row = table.row("P101")
    for column in POINT_COLUMNS:
        assert isinstance(row.cell(column), str)
    assert row.cell("locked") == "yes"


def test_rows_print_a_count():
    row = PointsRow("P101", normal_for=("K1(M)",), reverse_for=("K3(MB)",))
    assert str(row) == "P101: 2 routes"
    assert row.cell("normal for") == "K1(M)"


def test_the_machine_columns_come_from_the_plan(table):
    row = table.row("P101")
    assert row.cell("machine") == "electric"
    assert row.cell("throw") == "6.0s"
    assert row.motor.value == "electric"


def test_a_slow_set_of_points_is_found():
    from signalbox.topology.scheme import scheme_from_text

    scheme = scheme_from_text("""
    node A boundary
    node P1 points throw 20 lock no
    node B buffer
    node C boundary
    edge E1 from A to P1.toe length 100 direction down
    edge E2 from P1.normal to C length 100 direction down
    edge E3 from P1.reverse to B length 100 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    signal S1 on E1 at 100 facing forward direction down
    """)
    table = build_points_table(scheme, build_interlocking(scheme))
    assert [row.points for row in table.slow()] == ["P1"]
    assert [row.points for row in table.without_locks()] == ["P1"]
    assert table.row("P1").cell("throw") == "20.0s"


def test_points_with_no_machine_fall_back_to_the_defaults(kingsmoor):
    from signalbox.tables.points_table import PointsRow

    row = PointsRow("P9", facing_for=("K1(M)",))
    assert row.throw == 6.0
    assert row.motor.value == "electric"
    assert not row.lock_is_missing
