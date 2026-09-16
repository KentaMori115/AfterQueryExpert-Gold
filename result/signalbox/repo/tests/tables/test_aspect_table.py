import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect
from signalbox.tables.aspect_table import ASPECT_COLUMNS, AspectRow, build_aspect_table


@pytest.fixture
def table(kingsmoor):
    return build_aspect_table(kingsmoor, build_interlocking(kingsmoor))


def test_there_is_a_row_for_every_clearing_route(table, kingsmoor):
    lock = build_interlocking(kingsmoor)
    assert len(table) == len([p for p in lock if p.klass.clears_signal])


def test_rows_come_out_in_signal_order(table):
    names = [row.signal for row in table]
    assert names == sorted(names)


def test_a_row_shows_what_the_signal_displays(table):
    row = table.for_signal("K1")[0]
    assert row.ahead == "K3"
    assert row.cell("red") == "Y"
    assert row.cell("yellow") == "YY"
    assert row.cell("green") == "G"


def test_an_aspect_the_signal_ahead_cannot_show_is_a_dash(table):
    row = table.for_signal("K3")[0]
    assert row.cell("double yellow") == "-"


def test_the_row_carries_the_head_count(table):
    assert table.for_signal("K1")[0].cell("heads") == "4"


def test_protection_is_listed(table):
    assert "tss" in table.for_signal("K1")[0].cell("protection")


def test_a_route_out_of_the_area_says_so(table):
    row = table.for_signal("K5")[0]
    assert row.ahead == "out of area"
    assert row.cell("red") == "G"


def test_clamped_rows_are_the_read_through_problems(table):
    assert {row.route for row in table.clamped()}


def test_every_column_renders(table):
    row = table.for_signal("K1")[0]
    for column in ASPECT_COLUMNS:
        assert isinstance(row.cell(column), str)


def test_an_unknown_column_is_refused(table):
    with pytest.raises(KeyError, match="no such column"):
        table.for_signal("K1")[0].cell("weather")


def test_a_signal_with_no_route_has_no_rows(table):
    assert table.for_signal("K20") == []


def test_rows_print_their_sequence():
    row = AspectRow("K1", "K1(M)", "K3", 4, {Aspect.RED: Aspect.YELLOW})
    assert str(row) == "K1(M) behind K3: R>Y"
