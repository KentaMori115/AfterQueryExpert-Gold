"""The locking has to be consistent with itself.

These rules do not look at the layout. They look at what the interlocking has
already decided and ask whether it hangs together: that no two routes can be set
head on over the same track, that no route asks for the same points two ways at
once, and that nothing has quietly become a bottleneck that locks out half the
scheme.
"""

from __future__ import annotations

from collections.abc import Iterator
from itertools import combinations

from ..report import Finding, Severity
from ..rules import Context, rule

#: A route that locks out more than this share of the scheme is worth a look.
BOTTLENECK_SHARE = 0.6


@rule("locking-headon", "no two routes hold the same track head on", Severity.ERROR)
def opposing_routes_conflict(context: Context) -> Iterator[Finding]:
    table = context.locking
    matrix = context.matrix
    for first, second in combinations(table.sorted_entries(), 2):
        held = set(first.held_track())
        opposed = sorted(sub.name for sub in second.held_track() if sub.reverse in held)
        if not opposed:
            continue
        if matrix.clashes(first.route, second.route):
            continue
        yield Finding(
            rule="locking-headon",
            severity=Severity.ERROR,
            subject=first.route,
            message=f"{second.route} may be set at the same time over the same track",
            detail=", ".join(opposed),
        )


@rule("locking-split", "no route asks for points two ways at once", Severity.ERROR)
def points_are_not_asked_both_ways(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        route_points = dict(plan.points())
        for node, lie in plan.flank_points().items():
            wanted = route_points.get(node)
            if wanted is not None and wanted is not lie:
                yield Finding(
                    rule="locking-split",
                    severity=Severity.ERROR,
                    subject=plan.name,
                    message=(
                        f"{node} is run over {wanted.value} and wanted {lie.value} for flank"
                    ),
                    detail="the route cannot be set at all",
                )
        for node, lie in plan.overlap_points().items():
            wanted = route_points.get(node)
            if wanted is not None and wanted is not lie:
                yield Finding(
                    rule="locking-split",
                    severity=Severity.ERROR,
                    subject=plan.name,
                    message=(
                        f"{node} is run over {wanted.value} and held {lie.value} for overlap"
                    ),
                    detail="the route cannot be set at all",
                )


@rule("locking-bottleneck", "no route locks out most of the scheme", Severity.ADVICE)
def bottlenecks_are_reported(context: Context) -> Iterator[Finding]:
    total = len(context.interlocking)
    if total < 3:
        return
    for entry in context.locking:
        share = len(entry.locks_out) / (total - 1)
        if share < BOTTLENECK_SHARE:
            continue
        yield Finding(
            rule="locking-bottleneck",
            severity=Severity.ADVICE,
            subject=entry.route,
            message=f"locks out {len(entry.locks_out)} of {total - 1} other routes",
            detail=f"{share * 100:.0f} per cent of the scheme",
        )
