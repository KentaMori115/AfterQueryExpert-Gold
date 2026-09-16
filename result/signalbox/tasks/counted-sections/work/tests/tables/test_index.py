import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.index import KINDS, Uses, build_index


@pytest.fixture
def index(kingsmoor):
    return build_index(kingsmoor, build_interlocking(kingsmoor))


def test_the_kinds_are_the_ones_we_look_up():
    assert KINDS == ("signal", "section", "points", "edge", "crossing")


def test_a_name_is_recognised_as_what_it_is(index):
    assert index.kind_of("K1") == "signal"
    assert index.kind_of("TB") == "section"
    assert index.kind_of("P101") == "points"
    assert index.kind_of("D1") == "edge"
    assert index.kind_of("nothing") is None


def test_an_unknown_name_looks_up_to_nothing(index):
    assert index.look_up("nothing") is None


def test_a_signal_lists_the_routes_from_and_to_it(index):
    uses = index.look_up("K3")
    assert uses.routes == ("K3(MA)", "K3(MB)")
    assert uses.detail["reads to"] == ("K1(M)",)


def test_a_signal_held_for_flank_says_so(index):
    uses = index.look_up("K8")
    assert "K2(M)" in uses.detail["held for flank by"]


def test_a_section_lists_the_routes_over_it(index):
    uses = index.look_up("TB")
    assert "K1(M)" in uses.routes
    assert uses.detail["covers"] == ("D2",)


def test_a_section_in_an_overlap_says_so(index):
    uses = index.look_up("TD")
    assert "K1(M)" in uses.detail["in the overlap of"]


def test_points_list_what_calls_them(index):
    uses = index.look_up("P101")
    assert "K3(MA)" in uses.routes
    assert "K1(M)" in uses.detail["held for overlap by"]


def test_points_called_for_flank_say_so(index):
    assert "K1(M)" in index.look_up("P104").detail["called for flank by"]


def test_an_edge_lists_its_section_and_signals(index):
    uses = index.look_up("D1")
    assert uses.detail["in section"] == ("TA",)
    assert uses.detail["signals on it"] == ("K1",)


def test_a_crossing_lists_the_routes_over_it():
    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    scheme = build_scheme(load_path("tests/data/marlow-crossing.sbx"))
    index = build_index(scheme, build_interlocking(scheme))
    uses = index.look_up("LC21")
    assert "M1(M)" in uses.routes
    assert uses.detail["requirement"] == ("LC21 barriers down",)


def test_nothing_at_kingsmoor_is_unused(index):
    assert index.unused() == []


def test_a_berth_track_does_not_count_as_unused(index):
    # No route runs over TA, which is where a train waits to see K1.
    assert index.look_up("TA").routes == ()
    assert "TA" not in [uses.name for uses in index.unused()]


def test_a_section_no_route_touches_is_unused():
    from signalbox.topology.scheme import scheme_from_text

    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B buffer
    node C boundary
    edge E1 from A to P1.toe length 400 direction down
    edge E2 from P1.normal to C length 400 direction down
    edge E3 from P1.reverse to B length 400 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    """)
    index = build_index(scheme, build_interlocking(scheme))
    assert [uses.name for uses in index.unused()] == ["TA", "TB", "TC", "P1"]


def test_uses_print_as_a_short_block(index):
    text = str(index.look_up("TB"))
    assert text.startswith("section TB")
    assert "routes:" in text


def test_something_nothing_uses_says_so():
    uses = Uses("TZ", "section")
    assert not uses.used
    assert "nothing uses it" in str(uses)
