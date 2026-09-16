"""Warning routes: a main route with the overlap given up.

Where a platform is too short to hold a full overlap, the signal in rear can be
cleared on a warning arrangement instead: the driver gets a single yellow
whatever is in front, and the interlocking does not hold the usual overlap
beyond the platform starting signal. It is a main route in every other respect,
which is why it is made from one rather than found on its own.

A warning route is only offered where the plan asks for it, because giving one
away where it was not designed for is exactly the sort of thing that gets a
scheme sent back.
"""

from __future__ import annotations

from ..topology.scheme import Scheme
from .route import Route, RouteClass
from .signal import Aspect

#: The best a signal cleared for a warning route may show.
WARNING_ASPECT = Aspect.YELLOW

_TRUTHY = {"yes", "true", "1"}


def offers_warning(scheme: Scheme, signal: str) -> bool:
    """Whether the plan says this signal has a warning arrangement."""
    try:
        found = scheme.signal(signal)
    except Exception:
        return False
    return found.attributes.get("warning", "no").lower() in _TRUTHY


def warning_for(scheme: Scheme, route: Route) -> Route | None:
    """The warning route shadowing a main route, if the signal offers one."""
    if route.klass is not RouteClass.MAIN:
        return None
    if not offers_warning(scheme, route.entrance):
        return None
    return Route(
        entrance=route.entrance,
        exit=route.exit,
        klass=RouteClass.WARNING,
        path=route.path,
        points=dict(route.points),
        sections=route.sections,
        suffix=route.suffix,
    )


def add_warning_routes(scheme: Scheme, routes: list[Route]) -> list[Route]:
    """Every route, with a warning route added wherever the plan asks for one."""
    found = list(routes)
    for route in routes:
        shadow = warning_for(scheme, route)
        if shadow is not None:
            found.append(shadow)
    return sorted(found, key=lambda r: (r.entrance, r.klass.value, r.suffix, r.exit.name))


def warning_routes(routes: list[Route]) -> list[Route]:
    return [route for route in routes if route.klass is RouteClass.WARNING]
