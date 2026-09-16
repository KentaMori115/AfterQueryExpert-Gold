import pytest

from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.graph import Lie, Sense, build_graph
from signalbox.topology.position import Position
from signalbox.topology.walk import Path, explore
from signalbox.units import Distance


@pytest.fixture
def junction():
    text = """
    node W boundary
    node P1 points
    node E boundary
    node S buffer
    edge E1 from W to P1.toe length 400
    edge E2 from P1.normal to E length 300
    edge E3 from P1.reverse to S length 120
    """
    scheme = parse(text)
    validate(scheme)
    return build_graph(scheme)


def test_the_walk_starts_on_the_edge_you_are_standing_on(junction):
    paths = list(explore(junction, Position.at_start("E1")))
    assert all(path.edges[0] == "E1" for path in paths)


def test_both_ways_over_facing_points_are_found(junction):
    paths = {path.edges: path for path in explore(junction, Position.at_start("E1"))}
    assert set(paths) == {("E1", "E2"), ("E1", "E3")}
    assert paths[("E1", "E2")].lies == {"P1": Lie.NORMAL}
    assert paths[("E1", "E3")].lies == {"P1": Lie.REVERSE}


def test_length_is_measured_from_the_start_position(junction):
    start = Position("E1", Distance(150.0))
    lengths = {path.edges: path.length.metres for path in explore(junction, start)}
    assert lengths[("E1", "E2")] == pytest.approx(250.0 + 300.0)


def test_the_limit_truncates_the_walk(junction):
    start = Position.at_start("E1")
    paths = list(explore(junction, start, limit=Distance(560.0)))
    assert [path.edges for path in paths] == [("E1", "E3")]


def test_a_limit_shorter_than_the_first_edge_leaves_just_that_edge(junction):
    paths = list(explore(junction, Position.at_start("E1"), limit=Distance(10.0)))
    assert [path.edges for path in paths] == [("E1",)]


def test_a_trailing_move_does_not_branch(junction):
    paths = list(explore(junction, Position("E2", Distance(300.0), Sense.REVERSE)))
    assert [path.edges for path in paths] == [("E2", "E1")]


def test_stop_rule_ends_a_path_early(junction):
    def at_e2(path, position):
        return position.edge == "E2"

    paths = list(explore(junction, Position.at_start("E1"), stop=at_e2))
    assert ("E1", "E2") in {path.edges for path in paths}


def test_path_end_faces_the_way_of_travel(junction):
    path = next(p for p in explore(junction, Position.at_start("E1")) if p.uses("E3"))
    end = path.end(junction)
    assert end.edge == "E3"
    assert end.offset.metres == pytest.approx(120.0)
    assert end.sense is Sense.NOMINAL


def test_paths_needing_opposite_lies_conflict(junction):
    normal, reverse = sorted(explore(junction, Position.at_start("E1")), key=lambda p: p.edges)
    assert normal.conflicts_with(reverse)
    assert not normal.conflicts_with(normal)


def test_an_empty_path_prints_as_here():
    assert str(Path(start=Position.at_start("E1"))) == "(here)"


def test_a_path_prints_its_edges_with_direction(junction):
    path = next(p for p in explore(junction, Position.at_start("E1")) if p.uses("E2"))
    assert str(path) == "E1+ E2+"
