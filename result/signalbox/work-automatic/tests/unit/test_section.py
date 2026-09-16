import pytest

from signalbox.errors import TopologyError
from signalbox.layout.ast import SectionKind
from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.graph import build_graph
from signalbox.topology.position import Position
from signalbox.topology.section import Section, SectionMap, build_sections
from signalbox.topology.walk import explore

PLAN = """
node W boundary
node P1 points
node E boundary
node S buffer
edge E1 from W to P1.toe length 400
edge E2 from P1.normal to E length 300
edge E3 from P1.reverse to S length 120
section TA over E1
section TB over E2
section TC counted over E3
"""


@pytest.fixture
def scheme():
    parsed = parse(PLAN)
    validate(parsed)
    return parsed


@pytest.fixture
def graph(scheme):
    return build_graph(scheme)


@pytest.fixture
def sections(scheme):
    return build_sections(scheme)


def test_sections_are_indexed_by_name_and_edge(sections):
    assert len(sections) == 3
    assert "TA" in sections
    assert sections.section_for("E2").name == "TB"
    assert sections.name_for("E3") == "TC"
    assert sections.section_for("E9") is None


def test_axle_counter_sections_are_flagged(sections):
    assert sections.get("TC").is_counted
    assert not sections.get("TA").is_counted
    assert sections.get("TC").kind is SectionKind.AXLE_COUNTER


def test_section_length_adds_its_edges(sections, graph):
    assert sections.get("TA").length(graph).metres == pytest.approx(400.0)


def test_unknown_section_is_reported(sections):
    with pytest.raises(TopologyError, match="no section called TZ"):
        sections.get("TZ")


def test_a_section_cannot_be_defined_twice():
    with pytest.raises(TopologyError, match="defined twice"):
        SectionMap(
            [
                Section("TA", SectionKind.TRACK_CIRCUIT, ("E1",)),
                Section("TA", SectionKind.TRACK_CIRCUIT, ("E2",)),
            ]
        )


def test_an_edge_cannot_be_in_two_sections():
    with pytest.raises(TopologyError, match="in both TA and TB"):
        SectionMap(
            [
                Section("TA", SectionKind.TRACK_CIRCUIT, ("E1",)),
                Section("TB", SectionKind.TRACK_CIRCUIT, ("E1",)),
            ]
        )


def test_sections_over_a_path_come_out_in_order(sections, graph):
    path = next(p for p in explore(graph, Position.at_start("E1")) if p.uses("E2"))
    assert [s.name for s in sections.over_path(path)] == ["TA", "TB"]


def test_a_section_spanning_two_edges_is_not_listed_twice(graph):
    sections = SectionMap([Section("TA", SectionKind.TRACK_CIRCUIT, ("E1", "E2"))])
    path = next(p for p in explore(graph, Position.at_start("E1")) if p.uses("E2"))
    assert [s.name for s in sections.over_path(path)] == ["TA"]


def test_edges_with_no_section_are_reported(graph):
    sections = SectionMap([Section("TA", SectionKind.TRACK_CIRCUIT, ("E1",))])
    assert sections.unassigned(graph) == ["E2", "E3"]


def test_neighbours_follow_the_points_both_ways(sections, graph):
    assert sections.neighbours(graph, "TA") == {"TB", "TC"}
    assert sections.neighbours(graph, "TB") == {"TA"}
