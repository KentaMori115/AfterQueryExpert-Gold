import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.tables.sorting import (
    apply,
    check_columns,
    matching,
    parse_filter,
    sort_rows,
)


@pytest.fixture
def rows(kingsmoor):
    return list(build_control_table(kingsmoor, build_interlocking(kingsmoor)))


def test_sorting_by_one_column(rows):
    ordered = sort_rows(rows, ["to"])
    assert [row.cell("to") for row in ordered] == sorted(row.cell("to") for row in rows)


def test_sorting_by_two_columns(rows):
    ordered = sort_rows(rows, ["class", "route"])
    pairs = [(row.cell("class"), row.cell("route")) for row in ordered]
    assert pairs == sorted(pairs)


def test_sorting_by_nothing_leaves_the_order_alone(rows):
    assert [row.route for row in sort_rows(rows, [])] == [row.route for row in rows]


def test_sorting_by_a_column_that_is_not_there(rows):
    with pytest.raises(KeyError, match="no such column: weather"):
        sort_rows(rows, ["weather"])


def test_filtering_keeps_the_rows_that_match(rows):
    found = matching(rows, "route", "K3")
    assert {row.route for row in found} == {"K3(MA)", "K3(MB)"}


def test_filtering_ignores_case(rows):
    assert matching(rows, "route", "k3") == matching(rows, "route", "K3")


def test_filtering_on_a_column_that_is_not_there(rows):
    with pytest.raises(KeyError):
        matching(rows, "weather", "sunny")


def test_a_filter_expression_is_split_at_the_equals():
    assert parse_filter("route=K1") == ("route", "K1")
    assert parse_filter(" class = M ") == ("class", "M")


def test_an_expression_with_no_equals_is_refused():
    with pytest.raises(ValueError, match="expected column=text"):
        parse_filter("route")


def test_an_expression_with_no_column_is_refused():
    with pytest.raises(ValueError, match="no column"):
        parse_filter("=K1")


def test_filtering_and_sorting_together(rows):
    found = apply(rows, sort=["to"], filters=["class=M"])
    assert all(row.cell("class") == "M" for row in found)
    assert [row.cell("to") for row in found] == sorted(row.cell("to") for row in found)


def test_several_filters_are_all_applied(rows):
    found = apply(rows, filters=["class=M", "route=K3"])
    assert {row.route for row in found} == {"K3(MA)", "K3(MB)"}


def test_an_empty_table_takes_any_column():
    check_columns([], ["weather"])
    assert apply([], sort=["weather"]) == []
