"""Gradients, which decide whether the spacing that looked fine actually is.

Braking distance is worked out against the worst gradient on a route, which is
the right thing to do and hides two cases worth naming. A route that falls all
the way into its signal gives a driver no help at all at the point they need it
most. And a route steep enough that a stopped train may not restart is a route
that will block the section when it stalls.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.profile_helpers import falls_towards_the_signal, route_profile
from ...topology.profile import STEEP
from ..report import Finding, Severity
from ..rules import Context, rule

#: A route that drops more than this into its signal is worth naming.
NOTABLE_FALL = 5.0


@rule("gradient-falling", "routes do not fall into their signal", Severity.ADVICE)
def routes_do_not_fall_into_the_signal(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        if not plan.klass.clears_signal or not plan.route.exit.is_signal:
            continue
        if not falls_towards_the_signal(context.scheme, plan):
            continue
        shape = route_profile(context.scheme, plan)
        last = shape.stretches[-1]
        if abs(last.rise) < NOTABLE_FALL:
            continue
        yield Finding(
            rule="gradient-falling",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=f"falls {abs(last.rise):.1f}m into {plan.exit} at {last.gradient}",
            detail="the braking distance was worked out for it, but a driver has no help",
        )


@rule("gradient-steep", "no route is steep enough to stall a train", Severity.WARNING)
def routes_are_not_too_steep(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        shape = route_profile(context.scheme, plan)
        steep = shape.steep_stretches()
        if not steep:
            continue
        worst = max(steep, key=lambda stretch: abs(stretch.gradient.per_mille))
        yield Finding(
            rule="gradient-steep",
            severity=Severity.WARNING,
            subject=plan.name,
            message=f"runs over {worst.edge} at {worst.gradient}",
            detail=f"steeper than 1 in {STEEP:.0f}, a train that stops may not restart",
        )


@rule("gradient-summit", "summits inside a route are worth knowing about", Severity.ADVICE)
def summits_are_noted(context: Context) -> Iterator[Finding]:
    """A summit inside a section is where a stalled train ends up."""
    for plan in context.plans():
        shape = route_profile(context.scheme, plan)
        summits = shape.summits()
        if not summits:
            continue
        yield Finding(
            rule="gradient-summit",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=f"the road rises then falls on {', '.join(summits)}",
            detail=shape.describe(),
        )
