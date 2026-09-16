"""Small helpers that join two parts of the package without either owning it.

The gradient profile belongs to the topology and a route belongs to the
signalling, so working out the profile of a route belongs to neither. Rather
than making one import the other, it lives here.
"""

from __future__ import annotations

from ..topology.profile import Profile, profile
from ..topology.scheme import Scheme
from .interlocking import RoutePlan


def route_profile(scheme: Scheme, plan: RoutePlan) -> Profile:
    """The gradient profile of the track a route runs over, in order."""
    return profile(scheme.graph, plan.route.path.steps)


def overlap_profile(scheme: Scheme, plan: RoutePlan) -> Profile:
    """The profile of the overlap beyond a route, if it has one."""
    overlap = plan.overlap
    if overlap is None:
        return Profile()
    return profile(scheme.graph, overlap.steps)


def falls_towards_the_signal(scheme: Scheme, plan: RoutePlan) -> bool:
    """Whether a train on this route is running downhill at the exit signal.

    It is the last stretch that matters for stopping, not the average, and a
    route that climbs for a mile and then drops into the platform is the one
    that catches people out.
    """
    shape = route_profile(scheme, plan)
    if not shape.stretches:
        return False
    return shape.stretches[-1].falling
