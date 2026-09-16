import pytest

from signalbox.signalling.route import RouteClass, RouteEnd
from signalbox.signalling.routefind import SignalIndex, all_routes, routes_from
from signalbox.topology.graph import Lie, Sense
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance


@pytest.fixture
def routes(kingsmoor):
    return {route.name: route for route in all_routes(kingsmoor)}


def test_the_junction_yields_the_routes_we_expect(routes):
    assert set(routes) == {
        "K1(M)",
        "K1(S)",
        "K2(M)",
        "K3(MA)",
        "K3(MB)",
        "K4(M)",
        "K5(M)",
        "K6(M)",
        "K7(M)",
        "K8(M)",
        "K20(S)",
        "K22(S)",
    }


def test_a_plain_route_runs_signal_to_signal(routes):
    route = routes["K1(M)"]
    assert route.exit.name == "K3"
    assert route.edges == ("D2", "D3")
    assert route.sections == ("TB", "TC")
    assert route.length.metres == pytest.approx(500.0)


def test_length_is_measured_between_the_two_signals(routes):
    # D2 is 40m long and K3 stands 460m along D3.
    assert routes["K1(M)"].length.metres == pytest.approx(40.0 + 460.0)


def test_diverging_routes_get_letters(routes):
    assert routes["K3(MA)"].exit.name == "K5"
    assert routes["K3(MB)"].exit.name == "K7"
    assert routes["K3(MA)"].points == {"P101": Lie.NORMAL}
    assert routes["K3(MB)"].points == {"P101": Lie.REVERSE}


def test_a_single_route_from_a_signal_gets_no_letter(routes):
    assert routes["K1(M)"].suffix == ""


def test_a_route_over_the_crossover_records_both_points(routes):
    route = routes["K1(S)"]
    assert route.points == {"P103": Lie.REVERSE, "P104": Lie.REVERSE}
    assert route.klass is RouteClass.SHUNT


def test_routes_towards_a_shunt_signal_are_shunt_class(routes):
    assert routes["K1(S)"].exit.name == "K20"
    assert routes["K22(S)"].klass is RouteClass.SHUNT


def test_the_last_signal_has_a_route_out_to_the_boundary(routes):
    out = routes["K5(M)"]
    assert out.exit == RouteEnd.boundary("ED")
    assert out.edges == ("D6",)
    assert out.length.metres == pytest.approx(80.0)


def test_a_shunt_into_the_bay_ends_at_the_buffer(routes):
    into_bay = routes["K20(S)"]
    assert into_bay.exit == RouteEnd.buffer_stop("BAY")
    assert into_bay.klass is RouteClass.SHUNT
    assert into_bay.sections == ("TM", "TU")


def test_up_routes_run_the_other_way_along_their_edges(routes):
    route = routes["K2(M)"]
    assert route.edges == ("U7", "U6", "U5", "U4")
    assert route.path.steps[0][1] is Sense.REVERSE


def test_routes_from_one_signal_only(kingsmoor):
    from_k3 = routes_from(kingsmoor, kingsmoor.signal("K3"))
    assert [r.name for r in from_k3] == ["K3(MA)", "K3(MB)"]


def test_the_walk_gives_up_at_the_limit(kingsmoor):
    short = routes_from(kingsmoor, kingsmoor.signal("K1"), limit=Distance(100.0))
    assert short == []


def test_no_route_runs_against_the_direction_of_working(kingsmoor):
    for route in all_routes(kingsmoor):
        for edge, sense in route.path.steps:
            assert kingsmoor.graph.edge(edge).permits(sense), f"{route.name} over {edge}"


def test_wrong_direction_moves_onto_the_up_main_are_not_offered(routes):
    # K20 can shunt into the bay but not out onto the up main against the flow.
    assert [r.exit.name for r in [routes["K20(S)"]]] == ["BAY"]


def test_signals_facing_the_other_way_are_not_exits(kingsmoor):
    # K22 faces back down the bay, so a move up the bay does not end there.
    assert all(route.exit.name != "K22" for route in all_routes(kingsmoor))


def test_index_finds_the_nearest_signal_ahead(kingsmoor):
    index = SignalIndex(kingsmoor)
    assert index.next_on("D1", Sense.NOMINAL, Distance(0.0)).name == "K1"
    assert index.next_on("D1", Sense.NOMINAL, Distance(560.0)) is None
    assert index.next_on("D1", Sense.REVERSE, Distance(560.0)) is None


def test_index_looks_backwards_for_reverse_moves(kingsmoor):
    index = SignalIndex(kingsmoor)
    assert index.next_on("U8", Sense.REVERSE, Distance(40.0)).name == "K2"


def test_a_signal_facing_a_boundary_gets_one_route_out():
    scheme = scheme_from_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\n"
        "signal S1 on E1 at 200 facing forward\n"
    )
    assert [r.full_name for r in all_routes(scheme)] == ["S1(M) to B (boundary)"]
