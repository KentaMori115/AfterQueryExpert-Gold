"""Rules that work the interlocking rather than reading it.

Everything else in here inspects the data. These two drive the machine: they ask
for every route on an empty railway and see what happens, and then ask for pairs
of routes the conflict matrix says are compatible and check that the machine
agrees. A disagreement between the table and the machine means one of the two is
wrong, and finding out which is much cheaper here than on site.

A route worked automatically is not asked for at all. The machine refuses the
request, rightly, and reading that refusal as a fault would report every
automatic signal in the scheme as broken interlocking. What still has to hold is
that its signal clears, so that one is checked with the route left where it is.
"""

from __future__ import annotations

from collections.abc import Iterator
from itertools import combinations

from ...sim.machine import Machine
from ..report import Finding, Severity
from ..rules import Context, rule

#: Checking every compatible pair on a big scheme takes a while, so it stops here.
PAIR_LIMIT = 400


def _machine(context: Context) -> Machine:
    return Machine(context.scheme, context.interlocking)


@rule("setting-refused", "every route can be set on an empty railway", Severity.ERROR)
def every_route_can_be_set(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        if context.automatic.is_automatic(plan.name):
            continue
        machine = _machine(context)
        outcome = machine.request(plan.name)
        if outcome:
            continue
        yield Finding(
            rule="setting-refused",
            severity=Severity.ERROR,
            subject=plan.name,
            message="the interlocking refuses this route with nothing in the way",
            detail=outcome.reason,
        )


@rule("setting-clears", "every main route clears its signal", Severity.WARNING)
def every_main_route_clears(context: Context) -> Iterator[Finding]:
    """With a clear road ahead, a main route has to put a proceed aspect up.

    The road has to be cleared first, because a two aspect signal reading to
    another signal at danger is at danger itself and quite right too. So the
    check sets the route, then sets a route on from each signal it reaches, and
    only then looks at what the first signal is showing.
    """
    for plan in context.plans():
        if not plan.klass.clears_signal:
            continue
        machine = _machine(context)
        if not _standing(machine, plan.name) and not machine.request(plan.name):
            continue
        _clear_the_road(machine, plan.exit)
        machine.tick(60.0)
        if machine.showing(plan.entrance).is_proceed:
            continue
        yield Finding(
            rule="setting-clears",
            severity=Severity.WARNING,
            subject=plan.name,
            message=f"{plan.entrance} stays at danger with a clear road in front of it",
            detail="check the points the route calls and the track it holds",
        )


def _standing(machine: Machine, route: str) -> bool:
    """Whether this route is there already because the trains work it."""
    return machine.automatic.is_automatic(route)


def _clear_the_road(machine: Machine, signal: str, depth: int = 6) -> None:
    """Set a route on from each signal ahead, as far as ``depth`` signals."""
    seen: set[str] = set()
    here = signal
    for _ in range(depth):
        if here in seen:
            return
        seen.add(here)
        onward = machine.interlocking.from_signal(here)
        chosen = next((plan for plan in onward if plan.klass.clears_signal), None)
        if chosen is None:
            return
        if not _standing(machine, chosen.name) and not machine.request(chosen.name):
            return
        machine.tick(60.0)
        if not chosen.route.exit.is_signal:
            return
        here = chosen.exit


@rule("setting-pairs", "the machine agrees with the conflict table", Severity.ERROR)
def compatible_routes_can_both_be_set(context: Context) -> Iterator[Finding]:
    """Anything the table says is compatible has to be settable together."""
    plans = context.plans()
    matrix = context.matrix
    checked = 0

    for first, second in combinations(plans, 2):
        if checked >= PAIR_LIMIT:
            return
        if matrix.clashes(first.name, second.name):
            continue
        if context.automatic.is_automatic(first.name) or context.automatic.is_automatic(
            second.name
        ):
            continue
        checked += 1

        machine = _machine(context)
        if not machine.request(first.name):
            continue
        machine.tick(60.0)
        outcome = machine.request(second.name)
        if outcome:
            continue
        yield Finding(
            rule="setting-pairs",
            severity=Severity.ERROR,
            subject=f"{first.name}+{second.name}",
            message="the table says these do not conflict but the machine refuses",
            detail=outcome.reason,
        )
