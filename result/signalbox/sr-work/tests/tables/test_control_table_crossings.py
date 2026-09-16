import pytest

from signalbox.layout.loader import load_path
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import COLUMNS, build_control_table
from signalbox.tables.render import render_text
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def marlow():
    return build_scheme(load_path("tests/data/marlow-crossing.sbx"))


@pytest.fixture
def table(marlow):
    return build_control_table(marlow, build_interlocking(marlow))


def test_crossings_is_a_column():
    assert "crossings" in COLUMNS


def test_a_route_over_two_crossings_lists_both(table):
    row = table.row("M1(M)")
    assert row.crossings == ("LC21 barriers down", "LC23 strike in only")


def test_the_cell_joins_them_with_commas(table):
    assert table.row("M1(M)").cell("crossings") == ("LC21 barriers down, LC23 strike in only")


def test_a_route_over_a_user_worked_crossing_says_telephone(table):
    assert table.row("M3(M)").crossings == ("LC25 telephone",)


def test_a_scheme_with_no_crossings_leaves_the_column_empty(kingsmoor):
    table = build_control_table(kingsmoor, build_interlocking(kingsmoor))
    assert table.row("K1(M)").crossings == ()
    assert table.row("K1(M)").cell("crossings") == ""


def test_the_column_prints_in_the_table(table):
    text = render_text(table, ("route", "crossings"))
    assert "LC21 barriers down" in text
    assert text.splitlines()[0].split() == ["route", "crossings"]


def test_every_column_still_renders(table):
    for column in COLUMNS:
        assert isinstance(table.row("M1(M)").cell(column), str)
