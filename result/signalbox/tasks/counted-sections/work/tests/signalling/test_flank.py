import pytest

from signalbox.signalling.flank import (
    Flank,
    FlankKind,
    flanks_for,
    nodes_on,
    unprotected,
)
from signalbox.signalling.overlap import overlaps_for, preferred
from signalbox.signalling.routefind import all_routes
from signalbox.topology.graph import Lie
from signalbox.units import Distance


@pytest.fixture
def routes(kingsmoor):
    return {route.name: route for route in all_routes(kingsmoor)}


def flanks(scheme, route, with_overlap=True):
    overlap = preferred(overlaps_for(scheme, route)) if with_overlap else None
    return flanks_for(scheme, route, overlap_edges=overlap.edges if overlap else ())


def test_nodes_on_a_run_of_edges(kingsmoor):
    passed = nodes_on(kingsmoor.graph, ("D2", "D3", "D4", "D5"))
    assert passed == [
        ("P103", "toe", "normal"),
        ("J3", "1", "2"),
        ("P101", "toe", "normal"),
    ]


def test_a_route_over_a_crossover_is_protected_by_the_far_points(kingsmoor, routes):
    found = {f.node: f for f in flanks(kingsmoor, routes["K1(M)"], with_overlap=False)}
    assert found["P103"].kind is FlankKind.POINTS
    assert found["P103"].element == "P104"
    assert found["P103"].lie is Lie.NORMAL
    assert found["P103"].port == "reverse"


def test_a_signal_reading_towards_the_route_must_be_held(kingsmoor, routes):
    found = {f.node: f for f in flanks(kingsmoor, routes["K2(M)"], with_overlap=False)}
    assert found["P102"].kind is FlankKind.SIGNAL
    assert found["P102"].element == "K8"
    assert found["P102"].requirement() == "K8 at danger"


def test_the_overlap_brings_its_own_flanks(kingsmoor, routes):
    without = flanks(kingsmoor, routes["K1(M)"], with_overlap=False)
    with_overlap = flanks(kingsmoor, routes["K1(M)"])
    assert len(with_overlap) > len(without)
    assert any(f.node == "P101" for f in with_overlap)
    assert not any(f.node == "P101" for f in without)


def test_an_open_end_towards_the_branch_is_reported_as_unprotected(kingsmoor, routes):
    found = flanks(kingsmoor, routes["K3(MA)"], with_overlap=False)
    assert [f.kind for f in found] == [FlankKind.UNPROTECTED]
    assert unprotected(found) == found
    assert found[0].requirement() == "none"


def test_protection_kinds_know_whether_they_protect():
    assert FlankKind.POINTS.is_protection
    assert FlankKind.SIGNAL.is_protection
    assert FlankKind.DEAD_END.is_protection
    assert not FlankKind.UNPROTECTED.is_protection


def test_a_route_with_no_intermediate_nodes_has_no_flanks(kingsmoor, routes):
    assert flanks(kingsmoor, routes["K5(M)"]) == []


def test_flanks_print_where_they_are_and_what_holds_them():
    flank = Flank(
        "K1(M)", "P103", "reverse", FlankKind.POINTS, "P104", Lie.NORMAL, Distance(80.0)
    )
    assert str(flank) == "K1(M) flank at P103.reverse: P104 normal"
    assert flank.protected


def test_a_dead_end_needs_nothing_holding_it():
    flank = Flank("K9(M)", "P9", "reverse", FlankKind.DEAD_END, "BAY")
    assert flank.requirement() == "dead end"
    assert flank.protected


def test_every_route_in_the_scheme_can_be_examined(kingsmoor):
    for route in all_routes(kingsmoor):
        for flank in flanks(kingsmoor, route):
            assert flank.route == route.name
            assert flank.distance.metres >= 0


def test_the_flank_walk_stops_at_the_search_distance(kingsmoor, routes):
    close = flanks_for(kingsmoor, routes["K3(MA)"], search=Distance(1.0))
    assert all(flank.distance.metres <= 1.0 for flank in close)


def test_a_longer_search_finds_more(kingsmoor, routes):
    short = flanks_for(kingsmoor, routes["K2(M)"], search=Distance(1.0))
    long = flanks_for(kingsmoor, routes["K2(M)"], search=Distance(2000.0))
    assert sum(1 for f in long if f.protected) >= sum(1 for f in short if f.protected)


def test_the_distance_reported_is_where_the_protection_is(kingsmoor, routes):
    found = {f.node: f for f in flanks_for(kingsmoor, routes["K1(M)"])}
    assert found["P103"].distance.metres > 0
