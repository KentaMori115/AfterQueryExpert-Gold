import pytest

from signalbox.errors import LayoutError, TopologyError, UnknownReferenceError
from signalbox.layout.ast import NodeKind
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.graph import Lie, Sense, build_graph

PLAN = """
node A boundary
node B boundary
node C boundary
node D boundary
node X slip {settings}
edge E1 from A to X.a1 length 200 direction bidirectional
edge E2 from X.a2 to B length 200 direction bidirectional
edge E3 from C to X.b1 length 200 direction bidirectional
edge E4 from X.b2 to D length 200 direction bidirectional
section TA over E1
section TB over E2
section TC over E3
section TD over E4
"""


def graph_for(settings=""):
    scheme = parse(PLAN.format(settings=settings))
    validate(scheme)
    return build_graph(scheme)


def test_a_slip_is_a_kind_of_node():
    assert NodeKind.from_word("slip") is NodeKind.SLIP


def test_a_slip_lying_normal_is_a_plain_crossing():
    graph = graph_for()
    assert graph.step("E1", Sense.NOMINAL, Lie.NORMAL) == [("E2", Sense.NOMINAL)]
    assert graph.step("E3", Sense.NOMINAL, Lie.NORMAL) == [("E4", Sense.NOMINAL)]


def test_a_single_slip_lying_reverse_joins_one_road_to_the_other():
    graph = graph_for()
    assert graph.step("E1", Sense.NOMINAL, Lie.REVERSE) == [("E3", Sense.REVERSE)]


def test_a_single_slip_does_not_join_the_other_pair():
    graph = graph_for()
    assert graph.step("E2", Sense.REVERSE, Lie.REVERSE) == []


def test_a_double_slip_joins_both_pairs():
    graph = graph_for("double yes")
    assert graph.step("E2", Sense.REVERSE, Lie.REVERSE) == [("E4", Sense.NOMINAL)]
    assert graph.step("E1", Sense.NOMINAL, Lie.REVERSE) == [("E3", Sense.REVERSE)]


def test_a_slip_is_something_the_interlocking_has_to_call():
    graph = graph_for()
    assert graph.slips() == ["X"]
    assert graph.movable() == ["X"]
    assert graph.points() == []


def test_a_slip_needs_all_four_ends():
    text = PLAN.format(settings="").replace(
        "edge E4 from X.b2 to D length 200 direction bidirectional",
        "edge E4 from C to D length 200 direction bidirectional",
    )
    scheme = parse(text)
    with pytest.raises(LayoutError):
        validate(scheme)


def test_a_slip_port_has_to_exist():
    text = PLAN.format(settings="").replace("X.a1", "X.toe")
    with pytest.raises(UnknownReferenceError, match="no port 'toe'"):
        validate(parse(text))


def test_a_slip_with_a_missing_end_is_caught_by_the_graph():
    scheme = parse(PLAN.format(settings=""))
    scheme.edges.pop()
    with pytest.raises(TopologyError, match="missing b2"):
        build_graph(scheme)


def test_a_train_can_be_routed_over_a_slip():
    from signalbox.signalling.routefind import all_routes
    from signalbox.topology.scheme import build_scheme

    text = PLAN.format(settings="double yes") + (
        "signal S1 on E1 at 200 facing forward direction down\n"
        "signal S3 on E2 at 200 facing forward direction down\n"
    )
    scheme = build_scheme(parse(text))
    validate(parse(text))
    names = {route.name for route in all_routes(scheme)}
    assert "S1(MA)" in names or "S1(M)" in names
