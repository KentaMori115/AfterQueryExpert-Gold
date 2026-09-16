import pytest

from signalbox.layout.loader import load_path
from signalbox.signalling.callon import add_call_on_routes, call_on_for, call_on_routes
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.route import RouteClass
from signalbox.signalling.routefind import all_routes
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def thornley():
    return build_scheme(load_path("tests/data/thornley-platform.sbx"))


@pytest.fixture
def routes(thornley):
    return {route.name: route for route in all_routes(thornley)}


def test_a_signal_with_a_subsidiary_gets_a_call_on_route(routes):
    assert "T1(C)" in routes
    assert routes["T1(C)"].klass is RouteClass.CALL_ON


def test_the_call_on_shadows_the_main_route(routes):
    main = routes["T1(M)"]
    call_on = routes["T1(C)"]
    assert call_on.exit == main.exit
    assert call_on.sections == main.sections
    assert call_on.points == main.points


def test_a_signal_without_a_subsidiary_gets_none(routes):
    assert "T3(C)" not in routes
    assert "T3(M)" in routes


def test_kingsmoor_has_no_call_on_routes(kingsmoor):
    assert call_on_routes(all_routes(kingsmoor)) == []


def test_a_call_on_may_be_set_into_occupied_track(routes):
    assert routes["T1(C)"].klass.permits_occupied_track
    assert not routes["T1(M)"].klass.permits_occupied_track


def test_a_call_on_does_not_clear_the_main_aspect(routes):
    assert not routes["T1(C)"].klass.clears_signal


def test_a_call_on_gets_no_overlap(thornley):
    lock = build_interlocking(thornley)
    assert lock.plan("T1(C)").overlaps == ()
    assert lock.plan("T1(M)").overlaps


def test_shadowing_a_shunt_route_gives_nothing(thornley, routes):
    from signalbox.signalling.route import RouteEnd

    shunt = routes["T1(M)"]
    pretend = shunt.__class__(
        entrance=shunt.entrance,
        exit=RouteEnd.signal(shunt.exit.name),
        klass=RouteClass.SHUNT,
        path=shunt.path,
    )
    assert call_on_for(thornley, pretend) is None


def test_adding_call_on_routes_keeps_the_originals(thornley):
    plain = [r for r in all_routes(thornley) if r.klass is RouteClass.MAIN]
    both = add_call_on_routes(thornley, plain)
    assert len(both) == len(plain) + 1
    assert all(route in both for route in plain)


def test_a_signal_that_is_not_there_has_no_subsidiary(thornley):
    from signalbox.signalling.callon import has_subsidiary

    assert has_subsidiary(thornley, "T1")
    assert not has_subsidiary(thornley, "T99")
