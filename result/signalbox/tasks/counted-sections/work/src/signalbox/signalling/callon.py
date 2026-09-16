"""Call on routes: signalling a train up to the back of another one.

A main signal with a subsidiary aspect can be cleared into a section that is
already occupied, at a speed the driver can stop from within the distance they
can see. The route is otherwise the same as the main route it shadows, except
that it has no overlap, because there is nowhere for one and nothing to hold.

Call on routes are not found by walking the track. They are made from the main
routes that already exist, which keeps the two in step: move a signal and the
call on route moves with it.
"""

from __future__ import annotations

from ..topology.scheme import Scheme
from .route import Route, RouteClass


def has_subsidiary(scheme: Scheme, signal: str) -> bool:
    try:
        return scheme.signal(signal).subsidiary
    except Exception:
        return False


def call_on_for(scheme: Scheme, route: Route) -> Route | None:
    """The call on route shadowing a main route, if the signal has a subsidiary."""
    if route.klass is not RouteClass.MAIN:
        return None
    if not has_subsidiary(scheme, route.entrance):
        return None
    return Route(
        entrance=route.entrance,
        exit=route.exit,
        klass=RouteClass.CALL_ON,
        path=route.path,
        points=dict(route.points),
        sections=route.sections,
        suffix=route.suffix,
    )


def add_call_on_routes(scheme: Scheme, routes: list[Route]) -> list[Route]:
    """Every route in ``routes``, with a call on added wherever one is wanted."""
    found = list(routes)
    for route in routes:
        shadow = call_on_for(scheme, route)
        if shadow is not None:
            found.append(shadow)
    return sorted(found, key=lambda r: (r.entrance, r.klass.value, r.suffix, r.exit.name))


def call_on_routes(routes: list[Route]) -> list[Route]:
    return [route for route in routes if route.klass is RouteClass.CALL_ON]
