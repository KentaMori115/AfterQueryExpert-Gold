import pytest

from signalbox.errors import ParseError
from signalbox.layout.ast import Facing, NodeKind, SectionKind
from signalbox.layout.parser import parse

PLAN = """
scheme kingsmoor {
    area "Kingsmoor Junction"
    prefix K
}

# the down main comes in from the west
node A boundary
node P105 points
node B buffer

edge E1 from A to P105.toe length 420 speed 75 gradient 1 in 330
edge E2 from P105.normal to B length 180 speed 15 gradient level

section TA over E1, E2
section TB counted over E2

signal K12 on E1 at 380 facing forward aspects 4 type colour_light
"""


def test_scheme_block_sets_the_header():
    scheme = parse(PLAN)
    assert scheme.name == "kingsmoor"
    assert scheme.area == "Kingsmoor Junction"
    assert scheme.prefix == "K"


def test_nodes_carry_their_kind_and_line():
    scheme = parse(PLAN)
    assert [n.kind for n in scheme.nodes] == [
        NodeKind.BOUNDARY,
        NodeKind.POINTS,
        NodeKind.BUFFER,
    ]
    assert scheme.node("P105").line == 9


def test_edge_ends_keep_their_ports():
    edge = parse(PLAN).edge("E1")
    assert edge.start.node == "A" and edge.start.port is None
    assert edge.end.node == "P105" and edge.end.port == "toe"


def test_edge_attributes_are_read():
    scheme = parse(PLAN)
    assert scheme.edge("E1").speed_mph == 75.0
    assert scheme.edge("E1").gradient == "1 in 330"
    assert scheme.edge("E2").gradient == "level"


def test_sections_list_their_edges_in_order():
    scheme = parse(PLAN)
    assert scheme.sections[0].edges == ["E1", "E2"]
    assert scheme.sections[0].kind is SectionKind.TRACK_CIRCUIT
    assert scheme.sections[1].kind is SectionKind.AXLE_COUNTER


def test_signal_reads_position_and_facing():
    signal = parse(PLAN).signal("K12")
    assert signal.edge == "E1"
    assert signal.offset_metres == 380.0
    assert signal.facing is Facing.FORWARD
    assert signal.aspects == 4
    assert signal.attributes["type"] == "colour_light"


def test_signal_defaults_to_three_aspects():
    scheme = parse("edge E1 from A to B length 100\nsignal S1 on E1 at 10 facing backward\n")
    assert scheme.signal("S1").aspects == 3


def test_missing_length_is_an_error_naming_the_edge():
    with pytest.raises(ParseError) as excinfo:
        parse("edge E1 from A to B speed 40\n")
    assert "E1 has no length" in str(excinfo.value)


def test_unknown_declaration_is_rejected():
    with pytest.raises(ParseError, match="unknown declaration"):
        parse("wibble E1\n")


def test_unknown_node_kind_is_rejected():
    with pytest.raises(ParseError, match="not a kind of node"):
        parse("node A turntable\n")


def test_bad_facing_word_is_rejected():
    with pytest.raises(ParseError, match="use forward or backward"):
        parse("signal S1 on E1 at 10 facing sideways\n")


def test_unknown_scheme_setting_is_rejected():
    with pytest.raises(ParseError, match="unknown scheme setting"):
        parse("scheme k {\n  colour red\n}\n")


def test_errors_carry_the_source_name():
    with pytest.raises(ParseError) as excinfo:
        parse("node A\n", source="kingsmoor.sbx")
    assert str(excinfo.value).startswith("kingsmoor.sbx:1")


def test_a_plan_may_be_entirely_comments():
    assert parse("# nothing\n# at all\n").summary().endswith("0 signals")


def test_traffic_direction_is_recorded_as_a_label():
    scheme = parse(
        "edge E1 from A to B length 100\nsignal S1 on E1 at 10 facing forward direction down\n"
    )
    assert scheme.signal("S1").attributes["direction"] == "down"


def test_a_nonsense_traffic_direction_is_rejected():
    with pytest.raises(ParseError, match="not a traffic direction"):
        parse("signal S1 on E1 at 10 facing forward direction sideways\n")


def test_edges_can_declare_the_direction_they_are_worked_in():
    scheme = parse("edge D1 from A to B length 100 direction bidirectional\n")
    assert scheme.edge("D1").attributes["direction"] == "bidirectional"
