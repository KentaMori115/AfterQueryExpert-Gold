"""Train detection has to cover the layout, and it has to line up with the signals.

Track that no section covers is track the interlocking cannot see a train on,
which is an outright error. The next two rules are about how the detection is
cut up: a section so long that a route cannot release behind a train until it
has gone a very long way, and a signal that does not stand at a joint, so that
the section behind it is not a berth and the signal cannot be replaced behind a
train the moment it has passed.

The last is about the detection being counted rather than circuited. Counted
sections a train runs directly between are reset as one, so a reset zone wider
than a single section is a piece of railway that comes out of use together.
That is a decision worth making on purpose rather than by accident.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...topology.counting import build_counting
from ...units import Distance
from ..report import Finding, Severity
from ..rules import Context, rule

#: A section longer than this is worth a second look.
LONG_SECTION = Distance(1500.0)

#: How far from a joint a signal may stand before anyone minds.
JOINT_TOLERANCE = Distance(100.0)


@rule("detection-gap", "every piece of track is detected", Severity.ERROR)
def all_track_is_detected(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for edge in scheme.sections.unassigned(scheme.graph):
        length = scheme.graph.edge(edge).length
        yield Finding(
            rule="detection-gap",
            severity=Severity.ERROR,
            subject=edge,
            message="no track section covers this edge",
            detail=f"{length.metres:.0f}m undetected",
        )


@rule("detection-long", "sections are short enough to release usefully", Severity.WARNING)
def sections_are_not_too_long(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for name in sorted(scheme.sections.sections):
        section = scheme.sections.get(name)
        length = section.length(scheme.graph)
        if length.metres <= LONG_SECTION.metres:
            continue
        yield Finding(
            rule="detection-long",
            severity=Severity.WARNING,
            subject=name,
            message=f"section is {length.metres:.0f}m long",
            detail=f"over {LONG_SECTION.metres:.0f}m, sectional release will be coarse",
        )


@rule("detection-joint", "signals stand at a section joint", Severity.ADVICE)
def signals_stand_at_joints(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for signal in scheme.sorted_signals():
        edge = scheme.graph.edge(signal.position.edge)
        offset = signal.position.offset.metres
        from_joint = min(offset, edge.length.metres - offset)
        if from_joint <= JOINT_TOLERANCE.metres:
            continue
        yield Finding(
            rule="detection-joint",
            severity=Severity.ADVICE,
            subject=signal.name,
            message=f"stands {from_joint:.0f}m from the nearest section joint",
            detail=f"on {edge.name}, which is {edge.length.metres:.0f}m long",
        )


@rule("detection-zone", "reset zones are no wider than they need to be", Severity.WARNING)
def reset_zones_are_narrow(context: Context) -> Iterator[Finding]:
    """A reset zone over several sections takes all of them out of use at once."""
    scheme = context.scheme
    counting = build_counting(scheme.graph, scheme.sections)
    for zone in counting.wide_zones():
        yield Finding(
            rule="detection-zone",
            severity=Severity.WARNING,
            subject=zone.name,
            message=f"{len(zone.sections)} counted sections reset together",
            detail=", ".join(zone.sections) + " share a zone, so a reset takes the lot",
        )
