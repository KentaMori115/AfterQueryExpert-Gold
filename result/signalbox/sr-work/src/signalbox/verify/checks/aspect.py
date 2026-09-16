"""What the signals will actually be showing, and whether that is any use.

Three things go wrong with aspect sequences. A signal is asked to show something
it has not got the heads for, which quietly loses a driver a block of warning. A
main signal ends up with no route at all and so can never clear. And a junction
signal offers a diverging route at a much lower speed than the line, with no
approach control to make the driver slow down for it.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...topology.graph import Lie
from ...units import Speed
from ..report import Finding, Severity
from ..rules import Context, rule

#: A diverging route this much slower than the line wants approach control.
DIVERGENCE_MARGIN = 20.0


@rule("aspect-clamp", "signals can show the aspect the sequence wants", Severity.WARNING)
def aspects_are_not_clamped(context: Context) -> Iterator[Finding]:
    for aspect_rule in context.chart.clamped_rules():
        lost = [
            f"{ahead} wants {ahead.less_restrictive()}, shows {shown}"
            for ahead, shown in sorted(aspect_rule.table.items(), key=lambda p: p[0].value)
            if shown is not ahead.less_restrictive()
        ]
        yield Finding(
            rule="aspect-clamp",
            severity=Severity.WARNING,
            subject=aspect_rule.route,
            message=f"{aspect_rule.entrance} cannot show what the sequence asks for",
            detail="; ".join(lost),
        )


@rule("aspect-dark", "every running signal has a route", Severity.ERROR)
def signals_can_clear(context: Context) -> Iterator[Finding]:
    for name in context.chart.signals_that_never_clear(context.scheme):
        yield Finding(
            rule="aspect-dark",
            severity=Severity.ERROR,
            subject=name,
            message="no route reads from this signal, so it can never clear",
            detail="check the direction of working on the track it stands on",
        )


def _slowest(context: Context, edges: tuple[str, ...]) -> Speed | None:
    speeds = [context.scheme.graph.edge(name).speed for name in edges]
    known = [speed for speed in speeds if speed is not None]
    return min(known, key=lambda s: s.mps) if known else None


@rule("aspect-junction", "diverging routes are approach controlled", Severity.ADVICE)
def junctions_are_approach_controlled(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for plan in context.plans():
        if not plan.klass.clears_signal:
            continue
        if not any(lie is Lie.REVERSE for lie in plan.points().values()):
            continue
        approach_speed = scheme.graph.edge(scheme.signal(plan.entrance).position.edge).speed
        diverging = _slowest(context, plan.route.edges)
        if approach_speed is None or diverging is None:
            continue
        drop = approach_speed.mph - diverging.mph
        if drop < DIVERGENCE_MARGIN:
            continue
        if plan.route.path.lies and scheme.signal(plan.entrance).attributes.get("approach"):
            continue
        yield Finding(
            rule="aspect-junction",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=(
                f"diverges at {diverging} off a {approach_speed} line "
                "with no approach control declared"
            ),
            detail=f"{drop:.0f} mph drop",
        )
