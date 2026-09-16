import pytest

from signalbox.interchange.model import SCHEMA_VERSION, as_dict
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def data(kingsmoor):
    return as_dict(kingsmoor, build_interlocking(kingsmoor))


def test_the_schema_version_is_written(data):
    assert data["schema"] == SCHEMA_VERSION


def test_the_scheme_header_comes_through(data):
    assert data["scheme"] == {
        "name": "kingsmoor",
        "area": "Kingsmoor Junction",
        "prefix": "K",
    }


def test_every_edge_is_described(data, kingsmoor):
    assert len(data["track"]) == len(kingsmoor.graph.edges)
    d1 = next(edge for edge in data["track"] if edge["name"] == "D1")
    assert d1["length"] == 560.0
    assert d1["speed"] == 90.0
    assert d1["gradient"] == "1 in 330"
    assert d1["direction"] == "down"


def test_an_edge_with_no_speed_writes_null():
    from signalbox.topology.scheme import scheme_from_text

    scheme = scheme_from_text(
        "node A boundary\nnode B boundary\nedge E1 from A to B length 100\n"
    )
    data = as_dict(scheme, build_interlocking(scheme))
    assert data["track"][0]["speed"] is None


def test_sections_carry_their_edges_and_length(data):
    ta = next(section for section in data["sections"] if section["name"] == "TA")
    assert ta["edges"] == ["D1"]
    assert ta["length"] == 560.0
    assert ta["kind"] == "track_circuit"


def test_the_counted_section_says_so(data):
    tu = next(section for section in data["sections"] if section["name"] == "TU")
    assert tu["kind"] == "axle_counter"


def test_signals_carry_where_they_are_and_what_they_are(data):
    k1 = next(signal for signal in data["signals"] if signal["name"] == "K1")
    assert k1["edge"] == "D1"
    assert k1["offset"] == 560.0
    assert k1["facing"] == "nominal"
    assert k1["heads"] == 4
    assert k1["type"] == "main"
    assert k1["direction"] == "down"


def test_every_route_is_described(data, kingsmoor):
    assert len(data["routes"]) == len(build_interlocking(kingsmoor))
    assert [route["name"] for route in data["routes"]] == sorted(
        route["name"] for route in data["routes"]
    )


def test_a_route_carries_its_locking(data):
    route = next(r for r in data["routes"] if r["name"] == "K1(M)")
    assert route["entrance"] == "K1"
    assert route["exit"] == {"name": "K3", "kind": "signal"}
    assert route["points"] == {"P103": "normal"}
    assert route["points_held"] == {"P101": "normal", "P103": "normal", "P104": "normal"}
    assert route["track"] == ["TB-AB", "TC-AB", "TD-AB", "TE-AB"]
    assert route["release"] == "sectional"


def test_a_route_carries_its_overlaps(data):
    route = next(r for r in data["routes"] if r["name"] == "K1(M)")
    assert len(route["overlaps"]) == 2
    assert route["overlaps"][0]["full"] is True


def test_a_route_carries_its_flanks(data):
    route = next(r for r in data["routes"] if r["name"] == "K1(M)")
    kinds = {flank["kind"] for flank in route["flanks"]}
    assert "points" in kinds


def test_a_route_carries_its_approach_locking(data):
    route = next(r for r in data["routes"] if r["name"] == "K1(M)")
    assert route["approach"]["kind"] == "track and time"
    assert route["approach"]["watched"] == ["TA"]


def test_a_route_carries_its_aspect_sequence(data):
    route = next(r for r in data["routes"] if r["name"] == "K1(M)")
    assert route["aspects"]["red"] == "yellow"


def test_a_shunt_route_has_no_aspect_sequence(data):
    route = next(r for r in data["routes"] if r["name"] == "K20(S)")
    assert route["aspects"] == {}
    assert route["exit"]["kind"] == "buffer"


def test_the_same_scheme_gives_the_same_data_twice(kingsmoor):
    first = as_dict(kingsmoor, build_interlocking(kingsmoor))
    second = as_dict(kingsmoor, build_interlocking(kingsmoor))
    assert first == second
