"""Signals have to be far enough apart for a driver to stop.

The braking distance is worked out from the line speed of the track the route
runs over and the worst gradient on it, because a scheme that is fine on the
level can be wrong on the way down a bank.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.braking import required_spacing
from ...topology.scheme import Scheme
from ...units import Gradient, Speed
from ..report import Finding, Severity
from ..rules import Context, rule


def _worst_gradient(scheme: Scheme, edges: tuple[str, ...]) -> Gradient:
    """The gradient that helps braking least over a run of edges."""
    worst = Gradient.level()
    for name in edges:
        gradient = scheme.graph.edge(name).gradient
        if gradient.per_mille < worst.per_mille:
            worst = gradient
    return worst


def _line_speed(scheme: Scheme, edges: tuple[str, ...]) -> Speed | None:
    speeds = [scheme.graph.edge(name).speed for name in edges]
    known = [speed for speed in speeds if speed is not None]
    return max(known, key=lambda s: s.mps) if known else None


@rule("spacing-short", "signals are a braking distance apart", Severity.ERROR)
def signals_are_far_enough_apart(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for plan in context.plans():
        if not plan.klass.clears_signal or not plan.route.exit.is_signal:
            continue
        entrance = scheme.signal(plan.entrance)
        speed = _line_speed(scheme, plan.route.edges)
        if speed is None:
            continue
        gradient = _worst_gradient(scheme, plan.route.edges)
        wanted = required_spacing(
            speed, entrance.heads, gradient=gradient, model=context.braking
        )
        if plan.route.length.metres >= wanted.metres:
            continue
        yield Finding(
            rule="spacing-short",
            severity=Severity.ERROR,
            subject=plan.name,
            message=(
                f"{plan.route.length.metres:.0f}m between {plan.entrance} and "
                f"{plan.exit}, {wanted.metres:.0f}m wanted at {speed}"
            ),
            detail=f"{entrance.heads} aspect, {gradient}",
        )


@rule(
    "spacing-heads", "four aspect signalling is not broken by a three aspect", Severity.WARNING
)
def aspect_counts_do_not_step_down(context: Context) -> Iterator[Finding]:
    """A three aspect signal behind a four aspect one loses a warning."""
    scheme = context.scheme
    for plan in context.plans():
        if not plan.route.exit.is_signal or not plan.klass.clears_signal:
            continue
        entrance = scheme.signal(plan.entrance)
        ahead = scheme.signal(plan.exit)
        if entrance.heads >= ahead.heads or ahead.heads < 4:
            continue
        yield Finding(
            rule="spacing-heads",
            severity=Severity.WARNING,
            subject=plan.name,
            message=(
                f"{plan.entrance} has {entrance.heads} aspects behind "
                f"{ahead.heads} aspect {plan.exit}"
            ),
            detail="the double yellow it would need cannot be shown",
        )
