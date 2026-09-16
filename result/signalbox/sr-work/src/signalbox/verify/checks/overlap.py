"""Overlaps have to be there, and they have to be long enough.

A short overlap is not automatically wrong. Plenty of them are accepted where
the approach is slow or where a platform makes a full one impossible. What is
wrong is a short overlap nobody noticed, so the rule reports every one and lets
the scheme record say which were accepted and why.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.overlap import overlap_needed
from ..report import Finding, Severity
from ..rules import Context, rule


@rule("overlap-missing", "routes that should have an overlap have one", Severity.ERROR)
def overlaps_exist(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        if not overlap_needed(plan.route):
            continue
        if any(overlap.length.metres > 0 for overlap in plan.overlaps):
            continue
        yield Finding(
            rule="overlap-missing",
            severity=Severity.ERROR,
            subject=plan.name,
            message="no overlap could be found beyond the exit signal",
            detail=f"exit {plan.route.exit}",
        )


@rule("overlap-short", "overlaps reach the standard length", Severity.WARNING)
def overlaps_are_long_enough(context: Context) -> Iterator[Finding]:
    assert context.standard_overlap is not None
    wanted = context.standard_overlap.metres
    for plan in context.plans():
        for overlap in plan.overlaps:
            if overlap.length.metres >= wanted:
                continue
            short_by = wanted - overlap.length.metres
            yield Finding(
                rule="overlap-short",
                severity=Severity.WARNING,
                subject=plan.name,
                message=(
                    f"overlap {overlap.name} is {overlap.length.metres:.0f}m, "
                    f"{short_by:.0f}m short of standard"
                ),
                detail=", ".join(overlap.sections) or "no track",
            )


@rule("overlap-swing", "swinging overlaps are worth knowing about", Severity.ADVICE)
def swinging_overlaps(context: Context) -> Iterator[Finding]:
    for plan in context.plans():
        if not plan.swinging_overlap:
            continue
        names = ", ".join(overlap.name for overlap in plan.overlaps)
        yield Finding(
            rule="overlap-swing",
            severity=Severity.ADVICE,
            subject=plan.name,
            message=f"the overlap swings {len(plan.overlaps)} ways",
            detail=names,
        )
