import pytest

from signalbox.errors import TopologyError
from signalbox.topology.graph import Lie
from signalbox.topology.measure import Measurement, between, position_of
from signalbox.units import Distance


def test_a_signal_is_where_the_plan_puts_it(kingsmoor):
    at = position_of(kingsmoor, "K1")
    assert at.edge == "D1"
    assert at.offset.metres == 560.0


def test_an_edge_is_measured_from_its_start(kingsmoor):
    assert position_of(kingsmoor, "D3").offset.metres == 0.0


def test_a_node_is_where_its_first_edge_meets_it(kingsmoor):
    at = position_of(kingsmoor, "P101")
    assert at.edge in ("D4", "D5", "D7")


def test_a_crossing_can_be_measured_from():
    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    scheme = build_scheme(load_path("tests/data/marlow-crossing.sbx"))
    assert position_of(scheme, "LC21").edge == "B2"


def test_something_that_is_not_there_is_refused(kingsmoor):
    with pytest.raises(TopologyError, match="nothing called wibble"):
        position_of(kingsmoor, "wibble")


def test_the_distance_between_two_signals(kingsmoor):
    found = between(kingsmoor, "K1", "K3")
    assert found is not None
    assert found.metres == pytest.approx(500.0)


def test_the_distance_is_the_same_measured_backwards(kingsmoor):
    there = between(kingsmoor, "K1", "K3")
    back = between(kingsmoor, "K3", "K1")
    assert back is not None
    assert back.metres == pytest.approx(there.metres)


def test_the_edges_walked_are_reported(kingsmoor):
    found = between(kingsmoor, "K1", "K3")
    assert found.edges[0] == "D1"
    assert "D3" in found.edges


def test_the_points_decide_the_way_round(kingsmoor):
    normal = between(kingsmoor, "K3", "K5")
    reverse = between(kingsmoor, "K3", "K7", lies={"P101": Lie.REVERSE})
    assert normal is not None and reverse is not None
    assert normal.metres != reverse.metres


def test_somewhere_that_cannot_be_reached_measures_to_nothing(kingsmoor):
    assert between(kingsmoor, "K1", "K3", search=Distance(10.0)) is None


def test_a_signal_can_be_measured_to_a_node(kingsmoor):
    found = between(kingsmoor, "K1", "P103")
    assert found is not None
    assert found.metres > 0


def test_measurements_print_readably():
    found = Measurement("K1", "K3", Distance(500.0), ("D1", "D2", "D3"))
    assert str(found) == "K1 to K3: 0m 24.85ch"
    assert found.metres == 500.0
