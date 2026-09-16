import pytest

from signalbox.layout.loader import load_text
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.tables.diff import CellChange, Change, RowChange, diff_tables
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def table(kingsmoor):
    return build_control_table(kingsmoor, build_interlocking(kingsmoor))


def table_for(text):
    scheme = build_scheme(load_text(text))
    return build_control_table(scheme, build_interlocking(scheme))


def test_a_table_against_itself_shows_nothing(table):
    result = diff_tables(table, table)
    assert result.empty
    assert result.summary() == "no change"
    assert result.report() == "no change\n"


def test_a_removed_signal_removes_its_routes(kingsmoor_text, table):
    without = kingsmoor_text.replace(
        "signal K7 on D7 at 250 facing forward direction down aspects 2\n", ""
    )
    result = diff_tables(table, table_for(without))
    assert "K7(M)" in result.removed()
    assert result.of_kind(Change.REMOVED)


def test_an_added_signal_adds_a_route(kingsmoor_text, table):
    extra = kingsmoor_text + "signal K9 on D5 at 200 facing forward direction down aspects 3\n"
    result = diff_tables(table, table_for(extra))
    assert "K9(M)" in result.added()


def test_taking_a_head_off_a_signal_changes_its_aspect_column(kingsmoor_text, table):
    dimmer = kingsmoor_text.replace(
        "signal K1 on D1 at 560 facing forward direction down aspects 4",
        "signal K1 on D1 at 560 facing forward direction down aspects 3",
    )
    result = diff_tables(table, table_for(dimmer))
    changed = [change for change in result if change.route == "K1(M)"]
    assert changed and changed[0].change is Change.CHANGED
    assert changed[0].touches("aspect")


def test_the_diff_can_be_filtered_by_column(kingsmoor_text, table):
    dimmer = kingsmoor_text.replace("aspects 4", "aspects 3")
    result = diff_tables(table, table_for(dimmer))
    assert [change.route for change in result.touching("aspect")]
    assert result.touching("points normal") == []


def test_summary_counts_each_kind(kingsmoor_text, table):
    without = kingsmoor_text.replace(
        "signal K7 on D7 at 250 facing forward direction down aspects 2\n", ""
    )
    summary = diff_tables(table, table_for(without)).summary()
    assert "removed" in summary


def test_changes_print_readably():
    cell = CellChange("overlap", "TB", "TB, TC")
    assert str(cell) == "overlap: TB -> TB, TC"
    assert str(CellChange("flank", "", "P104 normal")) == "flank: - -> P104 normal"
    assert str(RowChange("K1(M)", Change.ADDED)) == "added K1(M)"
    assert str(RowChange("K1(M)", Change.CHANGED, (cell,))) == (
        "changed K1(M): overlap: TB -> TB, TC"
    )


def test_change_kinds_print_as_words():
    assert str(Change.CHANGED) == "changed"


def test_diffing_plain_row_lists_works(table):
    rows = [table.row("K1(M)")]
    assert diff_tables(rows, rows).empty
    assert diff_tables(rows, []).removed() == ["K1(M)"]


def test_only_the_listed_columns_are_compared(kingsmoor_text, table):
    dimmer = kingsmoor_text.replace("aspects 4", "aspects 3")
    result = diff_tables(table, table_for(dimmer), columns=("route", "from", "to"))
    assert result.empty
