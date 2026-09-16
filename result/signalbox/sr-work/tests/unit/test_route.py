import pytest

from signalbox.errors import RoutingError
from signalbox.signalling.route import EndKind, Route, RouteClass, RouteEnd
from signalbox.topology.graph import Lie, Sense
from signalbox.topology.position import Position
from signalbox.topology.walk import Path
from signalbox.units import Distance


def path(*edges, length=500.0, lies=None):
    return Path(
        start=Position.at_start(edges[0]),
        steps=tuple((edge, Sense.NOMINAL) for edge in edges),
        lies=lies or {},
        length=Distance(length),
    )


def route(entrance="K1", ending="K3", klass=RouteClass.MAIN, edges=("D1", "D2"), **kwargs):
    lies = kwargs.pop("points", {})
    return Route(
        entrance=entrance,
        exit=ending if isinstance(ending, RouteEnd) else RouteEnd.signal(ending),
        klass=klass,
        path=path(*edges, lies=lies),
        points=lies,
        sections=kwargs.pop("sections", ("TA", "TB")),
        **kwargs,
    )


def test_route_classes_know_what_they_permit():
    assert RouteClass.MAIN.is_main
    assert RouteClass.MAIN.clears_signal
    assert RouteClass.WARNING.clears_signal
    assert not RouteClass.CALL_ON.clears_signal
    assert RouteClass.SHUNT.permits_occupied_track
    assert not RouteClass.MAIN.permits_occupied_track


def test_route_class_prints_as_its_letter():
    assert str(RouteClass.CALL_ON) == "C"


def test_route_names_follow_the_usual_convention():
    assert route().name == "K1(M)"
    assert route(klass=RouteClass.SHUNT).name == "K1(S)"
    assert route(suffix="A").name == "K1(MA)"
    assert route().full_name == "K1(M) to K3"
    assert str(route()) == "K1(M) to K3"


def test_a_route_cannot_end_where_it_starts():
    with pytest.raises(RoutingError, match="ends where it starts"):
        route(ending="K1")


def test_a_route_must_cover_some_track():
    with pytest.raises(RoutingError, match="covers no track"):
        Route("K1", RouteEnd.signal("K3"), RouteClass.MAIN, Path(start=Position.at_start("D1")))


def test_ends_print_with_what_they_are():
    assert str(RouteEnd.signal("K3")) == "K3"
    assert str(RouteEnd.boundary("ED")) == "ED (boundary)"
    assert str(RouteEnd.buffer_stop("BAY")) == "BAY (buffer)"


def test_only_signal_ends_are_signals():
    assert RouteEnd.signal("K3").is_signal
    assert not RouteEnd.boundary("ED").is_signal
    assert RouteEnd.buffer_stop("BAY").kind is EndKind.BUFFER
    assert route().ends_at_a_signal
    assert not route(ending=RouteEnd.boundary("ED")).ends_at_a_signal


def test_route_reports_its_track(kingsmoor):
    r = route()
    assert r.edges == ("D1", "D2")
    assert r.uses_edge("D2") and not r.uses_edge("D3")
    assert r.uses_section("TA") and not r.uses_section("TZ")
    assert r.length.metres == pytest.approx(500.0)


def test_points_required_by_a_route():
    r = route(points={"P103": Lie.NORMAL})
    assert r.needs("P103") is Lie.NORMAL
    assert r.needs("P101") is None


def test_points_lying_opposite_ways_are_found():
    a = route(points={"P103": Lie.NORMAL, "P101": Lie.REVERSE})
    b = route(entrance="K3", ending="K5", points={"P103": Lie.REVERSE})
    assert a.points_against(b) == {"P103"}
    assert b.points_against(a) == {"P103"}


def test_points_only_one_route_cares_about_are_not_opposed():
    a = route(points={"P103": Lie.NORMAL})
    b = route(entrance="K3", ending="K5", points={})
    assert a.points_against(b) == set()


def test_shared_track_is_reported():
    a = route(sections=("TA", "TB"))
    b = route(entrance="K3", ending="K5", sections=("TB", "TC"))
    assert a.shares_track_with(b) == {"TB"}


def test_covered_edges_include_the_edge_the_signal_stands_on():
    r = Route(
        entrance="K1",
        exit=RouteEnd.signal("K3"),
        klass=RouteClass.MAIN,
        path=Path(
            start=Position("D1", Distance(560.0)),
            steps=(("D2", Sense.NOMINAL), ("D3", Sense.NOMINAL)),
            length=Distance(500.0),
        ),
    )
    assert r.edges == ("D2", "D3")
    assert r.covered_edges == ("D1", "D2", "D3")


def test_covered_edges_do_not_repeat_the_first_one():
    assert route().covered_edges == ("D1", "D2")
