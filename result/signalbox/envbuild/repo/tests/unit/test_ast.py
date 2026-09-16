from signalbox.layout.ast import (
    EdgeDecl,
    EndRef,
    Facing,
    NodeDecl,
    NodeKind,
    SchemeDecl,
    SectionDecl,
    SignalDecl,
)


def test_node_kind_lookup():
    assert NodeKind.from_word("points") is NodeKind.POINTS
    assert NodeKind.from_word("turntable") is None


def test_facing_has_an_opposite():
    assert Facing.BACKWARD.opposite is Facing.FORWARD
    assert Facing.FORWARD.opposite.opposite is Facing.FORWARD


def test_facing_words_are_relative_to_the_edge():
    assert Facing.from_word("forward") is Facing.FORWARD
    assert Facing.from_word("up") is None


def test_facing_lookup():
    assert Facing.from_word("backward") is Facing.BACKWARD
    assert Facing.from_word("sideways") is None


def test_end_ref_prints_with_its_port():
    assert str(EndRef("P105", "normal")) == "P105.normal"
    assert str(EndRef("A")) == "A"


def build_scheme():
    scheme = SchemeDecl(name="kingsmoor")
    scheme.nodes.append(NodeDecl("A", NodeKind.BOUNDARY))
    scheme.nodes.append(NodeDecl("P105", NodeKind.POINTS))
    scheme.edges.append(EdgeDecl("E1", EndRef("A"), EndRef("P105", "toe"), 420.0))
    scheme.sections.append(SectionDecl("TA", ["E1"]))
    scheme.signals.append(SignalDecl("K12", "E1", 380.0, Facing.FORWARD))
    return scheme


def test_lookup_helpers_find_declarations():
    scheme = build_scheme()
    assert scheme.node("P105").kind is NodeKind.POINTS
    assert scheme.edge("E1").length_metres == 420.0
    assert scheme.signal("K12").facing is Facing.FORWARD


def test_lookup_helpers_return_none_when_absent():
    scheme = build_scheme()
    assert scheme.node("Z") is None
    assert scheme.edge("E9") is None
    assert scheme.signal("K99") is None


def test_summary_counts_everything():
    assert build_scheme().summary() == "kingsmoor: 2 nodes, 1 edges, 1 sections, 1 signals"
