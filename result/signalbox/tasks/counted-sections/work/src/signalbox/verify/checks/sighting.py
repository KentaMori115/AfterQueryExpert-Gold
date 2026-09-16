"""Signals have to be visible for long enough to be read.

A signal nobody has measured is not a failure, it is a job somebody has not done
yet, so it is reported separately. A signal that has been measured and comes up
short is a design problem: either it moves, or the approach speed comes down, or
it gets a banner repeater in front of it.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...errors import InterlockingError
from ...signalling.sighting import (
    READING_TIME,
    Sighting,
    all_sightings,
    short,
    unmeasured,
)
from ..report import Finding, Severity
from ..rules import Context, rule


def _sightings(context: Context) -> list[Sighting]:
    try:
        return all_sightings(context.scheme)
    except InterlockingError:
        return []


@rule("sighting-short", "signals can be seen for long enough", Severity.ERROR)
def sighting_is_long_enough(context: Context) -> Iterator[Finding]:
    for found in short(_sightings(context)):
        yield Finding(
            rule="sighting-short",
            severity=Severity.ERROR,
            subject=found.signal,
            message=found.describe(),
            detail=(
                f"{found.short_by.metres:.0f}m short of "
                f"{READING_TIME:.0f} seconds at {found.speed}"
            ),
        )


@rule("sighting-unmeasured", "every signal has a sighting distance", Severity.ADVICE)
def sighting_is_measured(context: Context) -> Iterator[Finding]:
    for found in unmeasured(_sightings(context)):
        if found.wanted.metres <= 0:
            continue
        yield Finding(
            rule="sighting-unmeasured",
            severity=Severity.ADVICE,
            subject=found.signal,
            message="no sighting distance in the plan",
            detail=f"{found.wanted.metres:.0f}m is wanted at {found.speed}",
        )


@rule("sighting-nonsense", "sighting distances are numbers", Severity.ERROR)
def sighting_distances_are_numbers(context: Context) -> Iterator[Finding]:
    """A sighting distance that cannot be read is worse than none at all."""
    for signal in context.scheme.sorted_signals():
        written = signal.attributes.get("sighting")
        if written is None:
            continue
        try:
            float(written)
        except ValueError:
            yield Finding(
                rule="sighting-nonsense",
                severity=Severity.ERROR,
                subject=signal.name,
                message=f"a sighting distance of {written!r}",
                detail="it should be a number of metres",
            )
