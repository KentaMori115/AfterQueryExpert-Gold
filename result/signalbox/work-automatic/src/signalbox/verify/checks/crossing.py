"""Level crossings, checked from the road's point of view as well as the rail's.

The interlocking rules only cover the crossings the interlocking is responsible
for. The other two rules here are about the ones it is not: an automatic half
barrier gives road users a fixed warning time, and that only works if the strike
in point is far enough back from the crossing at the speed trains actually run.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...layout.ast import CrossingKind
from ...signalling.crossing import crossings_over
from ...units import Speed
from ..report import Finding, Severity
from ..rules import Context, rule

#: An open or user worked crossing on line faster than this is worth arguing about.
FAST_FOR_AN_OPEN_CROSSING = Speed.from_mph(50)


@rule("crossing-warning", "automatic crossings get their warning time", Severity.WARNING)
def strike_in_is_far_enough_back(context: Context) -> Iterator[Finding]:
    """The train has to be detected far enough out for the barriers to come down."""
    scheme = context.scheme
    for name in sorted(scheme.crossings):
        crossing = scheme.crossing(name)
        if crossing.kind is not CrossingKind.AUTOMATIC_HALF:
            continue
        edge = scheme.graph.edge(crossing.edge)
        speed = edge.speed
        if speed is None:
            continue
        wanted = crossing.strike_in_distance(speed)
        room = crossing.position.offset
        if room.metres >= wanted.metres:
            continue
        yield Finding(
            rule="crossing-warning",
            severity=Severity.WARNING,
            subject=name,
            message=(
                f"{wanted.metres:.0f}m of approach wanted at {speed}, "
                f"only {room.metres:.0f}m of {edge.name} in front of it"
            ),
            detail=f"{crossing.strike_in:.0f}s warning time",
        )


@rule("crossing-open", "open crossings are not on fast line", Severity.WARNING)
def open_crossings_are_on_slow_line(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for name in sorted(scheme.crossings):
        crossing = scheme.crossing(name)
        if crossing.kind not in (CrossingKind.OPEN, CrossingKind.USER_WORKED):
            continue
        speed = scheme.graph.edge(crossing.edge).speed
        if speed is None or speed.mps <= FAST_FOR_AN_OPEN_CROSSING.mps:
            continue
        yield Finding(
            rule="crossing-open",
            severity=Severity.WARNING,
            subject=name,
            message=f"a {crossing.kind.value} crossing on {speed} line",
            detail=f"over {FAST_FOR_AN_OPEN_CROSSING}",
        )


@rule("crossing-route", "routes over crossings say what they prove", Severity.ADVICE)
def routes_list_their_crossings(context: Context) -> Iterator[Finding]:
    """Note every route that runs over a crossing the interlocking must prove."""
    for plan in context.plans():
        over = [c for c in crossings_over(context.scheme, plan) if c.interlocked]
        if not over:
            continue
        yield Finding(
            rule="crossing-route",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=f"proves {len(over)} crossing" + ("s" if len(over) > 1 else ""),
            detail=", ".join(crossing.requirement() for crossing in over),
        )
