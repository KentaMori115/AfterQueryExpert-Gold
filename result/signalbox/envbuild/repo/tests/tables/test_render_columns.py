"""Choosing which columns come out, and in what order.

The control table is too wide to read whole, so every command that prints one
takes a column selection. That selection is the same idea in three places, and
it has to behave the same way in all of them.
"""

from __future__ import annotations

import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import COLUMNS, build_control_table
from signalbox.tables.render import NARROW, render_csv, render_markdown, render_text
from signalbox.tables.sorting import apply


@pytest.fixture
def rows(kingsmoor):
    return list(build_control_table(kingsmoor, build_interlocking(kingsmoor)))


def test_the_narrow_set_is_a_subset_of_the_whole():
    assert set(NARROW) <= set(COLUMNS)


def test_the_narrow_set_leads_with_the_route():
    assert NARROW[0] == "route"


def test_columns_come_out_in_the_order_asked_for(rows):
    text = render_csv(rows, ("to", "route"))
    assert text.splitlines()[0] == "to,route"


def test_one_column_on_its_own_works(rows):
    text = render_text(rows, ("route",))
    assert text.splitlines()[0].strip() == "route"


def test_the_same_column_twice_is_printed_twice(rows):
    assert render_csv(rows, ("route", "route")).splitlines()[0] == "route,route"


def test_every_column_can_be_printed_on_its_own(rows):
    for column in COLUMNS:
        assert render_csv(rows, (column,)).splitlines()[0] == column


def test_sorting_does_not_change_which_columns_come_out(rows):
    plain = render_csv(rows, NARROW).splitlines()[0]
    sorted_rows = render_csv(apply(rows, sort=["to"]), NARROW).splitlines()[0]
    assert plain == sorted_rows


def test_filtering_does_not_change_the_heading(rows):
    filtered = apply(rows, filters=["class=M"])
    assert render_markdown(filtered, NARROW).splitlines()[0].startswith("| route |")


def test_filtering_keeps_the_column_order(rows):
    filtered = apply(rows, filters=["route=K1"])
    assert render_csv(filtered, ("to", "route")).splitlines()[0] == "to,route"


def test_sorting_by_a_column_that_is_not_printed_still_works(rows):
    ordered = apply(rows, sort=["to"])
    assert len(render_csv(ordered, ("route",)).splitlines()) == len(rows) + 1
