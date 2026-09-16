import csv
import io

import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.tables.render import (
    NARROW,
    column_widths,
    render,
    render_csv,
    render_markdown,
    render_text,
)


@pytest.fixture
def table(kingsmoor):
    return build_control_table(kingsmoor, build_interlocking(kingsmoor))


def test_text_has_a_heading_and_a_rule(table):
    text = render_text(table, NARROW)
    lines = text.splitlines()
    assert lines[0].split() == [
        "route",
        "from",
        "to",
        "points",
        "normal",
        "points",
        "reverse",
        "track",
        "clear",
    ]
    assert set(lines[1]) <= {"-", " "}


def test_text_columns_line_up(table):
    text = render_text(table, ("route", "from", "to"))
    lines = text.splitlines()[2:]
    starts = {line.index("K", 1) for line in lines if "K" in line[1:]}
    assert len(starts) == 1


def test_column_widths_fit_the_widest_cell(table):
    widths = column_widths(list(table), ("route", "from"))
    assert widths[0] >= len("K3(MA)")
    assert widths[1] >= len("from")


def test_csv_round_trips(table):
    text = render_csv(table, NARROW)
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == list(NARROW)
    assert len(rows) == len(table) + 1
    assert rows[1][0] == "K1(M)"


def test_markdown_is_a_pipe_table(table):
    text = render_markdown(table, ("route", "from"))
    lines = text.splitlines()
    assert lines[0] == "| route | from |"
    assert lines[1] == "| --- | --- |"
    assert lines[2] == "| K1(M) | K1 |"


def test_markdown_shows_empty_cells_as_a_dash(table):
    text = render_markdown(table, ("route", "points reverse"))
    assert "| K1(M) | - |" in text


def test_render_dispatches_by_name(table):
    assert render(table, "text", NARROW) == render_text(table, NARROW)
    assert render(table, "csv", NARROW) == render_csv(table, NARROW)
    assert render(table, "markdown", NARROW) == render_markdown(table, NARROW)


def test_an_unknown_format_lists_the_ones_there_are(table):
    with pytest.raises(KeyError, match="no such format"):
        render(table, "postscript")


def test_an_unknown_column_is_refused(table):
    with pytest.raises(KeyError, match="no such column: weather"):
        render_text(table, ("route", "weather"))


def test_rendering_a_plain_list_of_rows_works(table):
    rows = [table.row("K1(M)")]
    assert "K1(M)" in render_text(rows, ("route",))


def test_the_points_table_renders_with_its_own_columns(kingsmoor):
    from signalbox.signalling.interlocking import build_interlocking
    from signalbox.tables.points_table import POINT_COLUMNS, build_points_table

    points = build_points_table(kingsmoor, build_interlocking(kingsmoor))
    text = render_text(list(points), POINT_COLUMNS)
    assert "P101" in text
    assert text.splitlines()[0].startswith("points")


def test_the_locking_table_renders_with_its_own_columns(kingsmoor):
    from signalbox.signalling.interlocking import build_interlocking
    from signalbox.tables.locking_table import LOCKING_COLUMNS, build_locking_report

    locking = build_locking_report(build_interlocking(kingsmoor))
    assert "TB-AB" in render_csv(list(locking), LOCKING_COLUMNS)


def test_an_empty_table_takes_any_columns():
    assert render_text([], ("anything", "at all")).startswith("anything")
