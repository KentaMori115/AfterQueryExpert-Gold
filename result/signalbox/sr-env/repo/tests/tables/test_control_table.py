import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import COLUMNS, ControlRow, build_control_table


@pytest.fixture
def table(kingsmoor):
    return build_control_table(kingsmoor, build_interlocking(kingsmoor))


def test_there_is_a_row_for_every_route(table, kingsmoor):
    assert len(table) == 12
    assert table.routes()[0] == "K1(M)"


def test_a_row_carries_the_route_and_its_ends(table):
    row = table.row("K1(M)")
    assert row.entrance == "K1"
    assert row.exit == "K3"
    assert row.klass == "M"


def test_points_are_split_by_the_way_they_lie(table):
    row = table.row("K3(MB)")
    assert row.points_reverse == ("P101",)
    assert row.points_normal == ()


def test_the_overlap_column_names_its_sections(table):
    assert table.row("K1(M)").overlap == ("TD", "TE")


def test_flank_points_print_the_lie_they_are_called_to(table):
    assert table.row("K1(M)").flank_points == ("P104 normal",)


def test_signals_held_for_flank_are_listed(table):
    assert table.row("K2(M)").signals_held == ("K22", "K8")


def test_track_to_be_clear_is_the_subroutes(table):
    assert table.row("K1(M)").track_clear == ("TB-AB", "TC-AB", "TD-AB", "TE-AB")


def test_the_approach_column_reads_as_a_sentence(table):
    assert table.row("K1(M)").approach.startswith("track and time on TA")


def test_the_aspect_column_shows_the_sequence(table):
    assert table.row("K1(M)").aspect == "R>Y Y>YY G>G"


def test_shunt_routes_say_so_in_the_aspect_column(table):
    assert table.row("K20(S)").aspect == "shunt"


def test_every_column_can_be_printed(table):
    row = table.row("K1(M)")
    for column in COLUMNS:
        assert isinstance(row.cell(column), str)
    assert set(row.as_dict()) == set(COLUMNS)


def test_a_column_can_be_pulled_out_whole(table):
    assert table.column("route") == table.routes()


def test_rows_can_be_found_by_signal(table):
    assert [row.route for row in table.for_signal("K3")] == ["K3(MA)", "K3(MB)"]


def test_rows_print_shortly():
    row = ControlRow("K1(M)", "K1", "K3", "M")
    assert str(row) == "K1(M) K1-K3"
    assert row.cell("points normal") == ""


def test_the_table_keeps_its_working(table):
    assert table.matrix.against("K1(M)")
    assert table.locking.entry("K1(M)").route == "K1(M)"
    assert table.chart.rule("K1(M)") is not None
