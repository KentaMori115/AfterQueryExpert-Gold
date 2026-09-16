"""Track worked both ways has to be signalled both ways.

Marking a piece of track bidirectional is cheap on a plan and expensive on the
ground. These rules ask whether the scheme has done the work: routes signalled over the
track in both directions, and signals that read the way the track they stand on
is actually worked.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...topology.graph import Sense
from ..report import Finding, Severity
from ..rules import Context, rule


def _senses_used(context: Context, edge: str) -> set[Sense]:
    found: set[Sense] = set()
    for plan in context.plans():
        for name, sense in plan.route.path.steps:
            if name == edge:
                found.add(sense)
    return found


@rule("reversible-unused", "bidirectional track is used both ways", Severity.ADVICE)
def bidirectional_track_is_used_both_ways(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for name in sorted(scheme.graph.edges):
        edge = scheme.graph.edge(name)
        if not edge.is_bidirectional:
            continue
        used = _senses_used(context, name)
        if len(used) >= 2:
            continue
        way = "neither way" if not used else "one way only"
        yield Finding(
            rule="reversible-unused",
            severity=Severity.ADVICE,
            subject=name,
            message=f"worked both ways but signalled {way}",
            detail="either it does not need to be bidirectional, or a route is missing",
        )


@rule("reversible-direction", "one way track is not signalled against itself", Severity.ERROR)
def one_way_track_is_not_signalled_backwards(context: Context) -> Iterator[Finding]:
    """A signal on one way track has to read the way the track is worked."""
    scheme = context.scheme
    for signal in scheme.sorted_signals():
        edge = scheme.graph.edge(signal.position.edge)
        if edge.is_bidirectional:
            continue
        if edge.permits(signal.position.sense):
            continue
        yield Finding(
            rule="reversible-direction",
            severity=Severity.ERROR,
            subject=signal.name,
            message=f"reads against the direction {edge.name} is worked in",
            detail=f"{edge.name} is {edge.direction} only",
        )
