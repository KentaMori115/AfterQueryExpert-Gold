import pytest

from signalbox.signalling.overlap import (
    OVERLAP_RELEASE_DELAY,
    REDUCED_OVERLAP,
    STANDARD_OVERLAP,
    Overlap,
    holds_section,
    overlap_needed,
    overlaps_for,
    preferred,
    release_delay,
    shortest,
    swinging,
)
from signalbox.signalling.routefind import all_routes
from signalbox.topology.graph import Lie, Sense
from signalbox.units import Distance


@pytest.fixture
def routes(kingsmoor):
    return {route.name: route for route in all_routes(kingsmoor)}


def test_two_hundred_yards_is_the_standard(kingsmoor):
    assert STANDARD_OVERLAP.yards == pytest.approx(200.0, abs=0.5)
    assert REDUCED_OVERLAP.yards == pytest.approx(50.0, abs=0.5)


def test_a_plain_route_gets_one_overlap(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K2(M)"])
    assert len(overlaps) == 1
    assert overlaps[0].sections == ("TL",)
    assert overlaps[0].length.metres == pytest.approx(STANDARD_OVERLAP.metres)
    assert overlaps[0].full


def test_an_overlap_over_facing_points_swings(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K1(M)"])
    assert [o.name for o in overlaps] == ["K1(M)A", "K1(M)B"]
    assert swinging(overlaps)
    assert overlaps[0].points == {"P101": Lie.NORMAL}
    assert overlaps[1].points == {"P101": Lie.REVERSE}
    assert all(o.swings for o in overlaps)


def test_the_preferred_overlap_is_the_first(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K1(M)"])
    assert preferred(overlaps) is overlaps[0]
    assert preferred([]) is None


def test_an_overlap_that_runs_out_of_track_is_not_full(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K3(MA)"])
    assert len(overlaps) == 1
    assert not overlaps[0].full
    assert overlaps[0].length.metres == pytest.approx(80.0)


def test_a_shorter_standard_gives_a_shorter_overlap(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K2(M)"], standard=REDUCED_OVERLAP)
    assert overlaps[0].length.metres == pytest.approx(REDUCED_OVERLAP.metres)
    assert overlaps[0].sections == ("TL",)


def test_routes_that_end_at_a_boundary_have_no_overlap(kingsmoor, routes):
    assert overlaps_for(kingsmoor, routes["K5(M)"]) == []
    assert not overlap_needed(routes["K5(M)"])


def test_shunt_routes_have_no_overlap(kingsmoor, routes):
    assert overlaps_for(kingsmoor, routes["K1(S)"]) == []
    assert not overlap_needed(routes["K1(S)"])


def test_overlap_prints_its_track_and_length():
    overlap = Overlap("K1(M)", (("D2", Sense.NOMINAL),), ("TB",), {}, Distance(183.0), "A")
    assert str(overlap) == "K1(M)A: TB (183m)"
    assert overlap.edges == ("D2",)
    assert Overlap("K9(M)", (), (), {}, Distance(0.0)).name == "K9(M)"
    assert str(Overlap("K9(M)", (), (), {}, Distance(0.0))) == "K9(M): none (0m)"


def test_an_overlap_records_which_way_it_runs(kingsmoor, routes):
    overlap = overlaps_for(kingsmoor, routes["K2(M)"])[0]
    assert overlap.steps[0] == ("U3", Sense.REVERSE)


def test_every_overlap_starts_beyond_its_exit_signal(kingsmoor):
    for route in all_routes(kingsmoor):
        for overlap in overlaps_for(kingsmoor, route):
            signal = kingsmoor.signal(route.exit.name)
            beyond = kingsmoor.graph.step(signal.position.edge, signal.position.sense)
            assert overlap.edges[0] in [edge for edge, _ in beyond]


def test_a_full_overlap_is_released_after_the_standard_delay(kingsmoor, routes):
    overlap = overlaps_for(kingsmoor, routes["K2(M)"])[0]
    assert release_delay(overlap) == pytest.approx(OVERLAP_RELEASE_DELAY)


def test_a_short_overlap_is_released_as_soon_as_the_train_stands(kingsmoor, routes):
    overlap = overlaps_for(kingsmoor, routes["K3(MA)"])[0]
    assert release_delay(overlap) == 0.0


def test_the_shortest_overlap_is_the_one_that_gets_in_the_way_of_least(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K1(M)"])
    assert shortest(overlaps).length.metres <= overlaps[0].length.metres
    assert shortest([]) is None


def test_asking_whether_an_overlap_holds_a_section(kingsmoor, routes):
    overlaps = overlaps_for(kingsmoor, routes["K1(M)"])
    assert holds_section(overlaps, "TD")
    assert not holds_section(overlaps, "TF")
