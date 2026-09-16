"""The routes themselves: are there too many, too few, or the wrong ones.

Route finding does what the layout tells it, which means a mistake in the layout
comes out as a route that should not exist rather than as an error. These rules
are the ones that look at the answer and ask whether it is sensible.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.route import RouteClass
from ...units import Speed
from ..report import Finding, Severity
from ..rules import Context, rule

#: A route more than this many times the average is worth looking at.
OUT_OF_STEP = 2.5

#: Shunt moves are made at a speed the driver can stop from.
SHUNT_SPEED = Speed.from_mph(25)


@rule("route-none", "every signal has somewhere to go", Severity.ERROR)
def signals_have_routes(context: Context) -> Iterator[Finding]:
    interlocking = context.interlocking
    for signal in context.scheme.sorted_signals():
        if interlocking.from_signal(signal.name):
            continue
        yield Finding(
            rule="route-none",
            severity=Severity.ERROR,
            subject=signal.name,
            message="no route reads from this signal",
            detail="it can never be cleared, so it does nothing but stop trains",
        )


@rule("route-duplicate", "no two routes are the same route twice", Severity.WARNING)
def routes_are_not_duplicated(context: Context) -> Iterator[Finding]:
    seen: dict[tuple[str, str, str, tuple[str, ...]], list[str]] = {}
    for plan in context.plans():
        key = (
            plan.entrance,
            plan.exit,
            plan.klass.value,
            tuple(f"{node}:{lie.value}" for node, lie in sorted(plan.points().items())),
        )
        seen.setdefault(key, []).append(plan.name)

    for key, names in sorted(seen.items()):
        if len(names) < 2:
            continue
        yield Finding(
            rule="route-duplicate",
            severity=Severity.WARNING,
            subject=names[0],
            message=f"the same move is signalled {len(names)} times",
            detail=", ".join(names) + f" all run {key[0]} to {key[1]}",
        )


@rule("route-long", "no route is far longer than the rest", Severity.ADVICE)
def routes_are_not_too_long(context: Context) -> Iterator[Finding]:
    """A route much longer than its neighbours usually means a signal is missing."""
    lengths = {
        plan.name: plan.route.length.metres
        for plan in context.plans()
        if plan.klass.clears_signal and plan.route.exit.is_signal
    }
    if len(lengths) < 3:
        return
    average = sum(lengths.values()) / len(lengths)

    for name, length in sorted(lengths.items()):
        if length < average * OUT_OF_STEP:
            continue
        yield Finding(
            rule="route-long",
            severity=Severity.ADVICE,
            subject=name,
            message=f"{length:.0f}m against an average of {average:.0f}m",
            detail="a signal in between would give the line more capacity",
        )


@rule("route-shunt", "shunt routes are over slow track", Severity.ADVICE)
def shunt_routes_are_slow(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for plan in context.plans():
        if plan.klass is not RouteClass.SHUNT:
            continue
        speeds = [scheme.graph.edge(edge).speed for edge in plan.route.edges]
        fastest = max((s for s in speeds if s is not None), key=lambda s: s.mps, default=None)
        if fastest is None or fastest.mps <= SHUNT_SPEED.mps:
            continue
        yield Finding(
            rule="route-shunt",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=f"a shunt move over {fastest} track",
            detail=f"shunting is normally limited to {SHUNT_SPEED}",
        )
