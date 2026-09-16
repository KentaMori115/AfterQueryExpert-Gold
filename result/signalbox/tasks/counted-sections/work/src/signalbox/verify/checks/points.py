"""The points themselves, rather than the routes that call them.

A facing move over unlocked points is the classic way of putting a train on the
floor, so that one is an error. The other two are about the schedule rather than
the safety case: points that nothing calls are usually a drafting leftover, and
points that take a long time to throw make every route that calls them slow to
set.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.points import SLOW_THROW
from ...tables.points_table import PointsTable, build_points_table
from ..report import Finding, Severity
from ..rules import Context, rule


def _table(context: Context) -> PointsTable:
    return build_points_table(context.scheme, context.interlocking)


@rule("points-lock", "facing points are locked", Severity.ERROR)
def facing_points_are_locked(context: Context) -> Iterator[Finding]:
    for row in _table(context).without_locks():
        yield Finding(
            rule="points-lock",
            severity=Severity.ERROR,
            subject=row.points,
            message="carries a facing move with no lock on the blades",
            detail=", ".join(row.facing_for),
        )


@rule("points-hand", "hand points are not on signalled routes", Severity.WARNING)
def hand_points_are_not_signalled(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for row in _table(context):
        machine = scheme.machines.get(row.points)
        if machine is None or machine.can_be_called or not row.routes:
            continue
        yield Finding(
            rule="points-hand",
            severity=Severity.WARNING,
            subject=row.points,
            message="is hand worked but routes are signalled over it",
            detail=", ".join(row.routes),
        )


@rule("points-unused", "every set of points is used by something", Severity.ADVICE)
def points_are_used(context: Context) -> Iterator[Finding]:
    for row in _table(context).unused():
        yield Finding(
            rule="points-unused",
            severity=Severity.ADVICE,
            subject=row.points,
            message="no route runs over it, holds it for overlap, or calls it for flank",
            detail="check the direction of working on the track around it",
        )


@rule("points-slow", "points throw quickly enough", Severity.ADVICE)
def points_are_not_slow(context: Context) -> Iterator[Finding]:
    for row in _table(context).slow(SLOW_THROW):
        yield Finding(
            rule="points-slow",
            severity=Severity.ADVICE,
            subject=row.points,
            message=f"takes {row.throw:.1f}s to throw",
            detail=f"every route calling it waits, over {SLOW_THROW:.0f}s",
        )
