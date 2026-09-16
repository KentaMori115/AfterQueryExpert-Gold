import pytest

from signalbox.errors import TopologyError, UnitError
from signalbox.topology.chainage import chainage, declared, parse_mileage
from signalbox.topology.position import Position
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance

PLAN = """
node A boundary
node J plain
node B boundary
edge E1 from A to J length 1610 mileage "12m 0ch" direction down
edge E2 from J to B length 1610 direction down
section TA over E1
section TB over E2
"""


@pytest.fixture
def scheme():
    return scheme_from_text(PLAN)


def test_a_declared_mileage_is_read(scheme):
    assert declared(scheme)["A"].as_miles_chains()[0] == 12


def test_the_datum_keeps_its_mileage(scheme):
    marks = chainage(scheme)
    assert marks.at("A").as_miles_chains() == (12, pytest.approx(0.0))
    assert marks.datum == "A"


def test_mileage_grows_with_the_down_direction(scheme):
    marks = chainage(scheme)
    assert marks.at("J").metres > marks.at("A").metres
    assert marks.at("B").metres > marks.at("J").metres


def test_the_mileage_of_a_node_is_the_lengths_added_up(scheme):
    marks = chainage(scheme)
    assert marks.at("J").metres == pytest.approx(marks.at("A").metres + 1610)


def test_the_mileage_of_a_position_along_an_edge(scheme):
    marks = chainage(scheme)
    at = marks.of(scheme, Position("E2", Distance(805.0)))
    assert at.metres == pytest.approx(marks.at("J").metres + 805.0)


def test_every_node_is_reached(scheme):
    assert chainage(scheme).missing(scheme) == []


def test_a_scheme_with_no_mileage_gets_nothing(kingsmoor):
    marks = chainage(kingsmoor)
    assert marks.is_empty
    assert marks.describe() == "no mileage in this scheme"


def test_a_datum_can_be_chosen(scheme):
    marks = chainage(scheme, datum="B")
    assert marks.at("B").metres == 0.0
    assert marks.at("A").metres == pytest.approx(-3220.0)


def test_an_unknown_datum_is_refused(scheme):
    with pytest.raises(TopologyError, match="no node called Z"):
        chainage(scheme, datum="Z")


def test_asking_for_a_node_that_was_not_reached(scheme):
    marks = chainage(scheme)
    with pytest.raises(TopologyError, match="no mileage worked out"):
        marks.at("Z")
    assert not marks.known("Z")


def test_the_chainage_describes_its_range(scheme):
    assert "to" in chainage(scheme).describe()
    assert "from A" in chainage(scheme).describe()


def test_mileages_are_parsed_the_usual_way():
    assert parse_mileage("1m 0ch").metres == pytest.approx(1609.344, abs=0.01)
    with pytest.raises(UnitError):
        parse_mileage("somewhere")
