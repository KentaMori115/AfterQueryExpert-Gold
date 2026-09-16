import pytest

from signalbox.layout.loader import load_path
from signalbox.signalling.aspects import build_chart
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.route import RouteClass
from signalbox.signalling.routefind import all_routes
from signalbox.signalling.signal import Aspect
from signalbox.signalling.warning import (
    WARNING_ASPECT,
    add_warning_routes,
    offers_warning,
    warning_for,
    warning_routes,
)
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def hallowgate():
    return build_scheme(load_path("tests/data/hallowgate-warning.sbx"))


@pytest.fixture
def routes(hallowgate):
    return {route.name: route for route in all_routes(hallowgate)}


def test_a_signal_with_a_warning_arrangement_gets_a_warning_route(routes):
    assert "H1S(W)" in routes
    assert routes["H1S(W)"].klass is RouteClass.WARNING


def test_the_warning_route_shadows_the_main_one(routes):
    assert routes["H1S(W)"].sections == routes["H1S(M)"].sections
    assert routes["H1S(W)"].exit == routes["H1S(M)"].exit


def test_a_signal_without_the_arrangement_gets_none(routes):
    assert "H3S(W)" not in routes


def test_the_plan_is_what_decides(hallowgate):
    assert offers_warning(hallowgate, "H1S")
    assert not offers_warning(hallowgate, "H3S")
    assert not offers_warning(hallowgate, "H9S")


def test_a_warning_route_still_clears_the_signal(routes):
    assert routes["H1S(W)"].klass.clears_signal


def test_a_warning_route_gets_no_overlap(hallowgate):
    lock = build_interlocking(hallowgate)
    assert lock.plan("H1S(W)").overlaps == ()
    assert lock.plan("H1S(M)").overlaps


def test_a_warning_route_shows_a_single_yellow(hallowgate):
    chart = build_chart(hallowgate, build_interlocking(hallowgate))
    rule = chart.rule("H1S(W)")
    assert rule.shown(Aspect.GREEN) is WARNING_ASPECT
    assert rule.shown(Aspect.RED) is WARNING_ASPECT


def test_the_main_route_still_steps_up(hallowgate):
    chart = build_chart(hallowgate, build_interlocking(hallowgate))
    assert chart.rule("H1S(M)").shown(Aspect.GREEN) is Aspect.GREEN


def test_kingsmoor_has_no_warning_routes(kingsmoor):
    assert warning_routes(all_routes(kingsmoor)) == []


def test_shadowing_a_shunt_route_gives_nothing(hallowgate, routes):
    from signalbox.signalling.route import Route, RouteEnd

    shunt = routes["H1S(M)"]
    pretend = Route(
        entrance=shunt.entrance,
        exit=RouteEnd.signal(shunt.exit.name),
        klass=RouteClass.SHUNT,
        path=shunt.path,
    )
    assert warning_for(hallowgate, pretend) is None


def test_adding_warning_routes_keeps_the_originals(hallowgate):
    plain = [r for r in all_routes(hallowgate) if r.klass is RouteClass.MAIN]
    both = add_warning_routes(hallowgate, plain)
    assert len(both) == len(plain) + 1
