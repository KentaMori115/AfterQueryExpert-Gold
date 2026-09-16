"""The design figures themselves, checked for sense.

A scheme can be drawn to any figures it likes, but some combinations do not
describe anything. An overlap shorter than the distance a train takes to stop
from the speed it is allowed to approach at is not an overlap. A braking rate
outside the range real trains manage means every spacing check is meaningless.
And a flank search shorter than the sections it has to look across will report
protection that is there as missing.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.braking import BrakingModel
from ...units import Speed
from ..report import Finding, Severity
from ..rules import Context, rule

#: What real trains manage, in metres per second squared.
PLAUSIBLE_BRAKING = (0.2, 1.2)

#: The speed an overlap is expected to hold a train from.
OVERLAP_APPROACH = Speed.from_mph(15)


@rule("standards-braking", "the braking rate is one a train could manage", Severity.WARNING)
def braking_is_plausible(context: Context) -> Iterator[Finding]:
    rate = context.scheme.standards.braking
    low, high = PLAUSIBLE_BRAKING
    if low <= rate <= high:
        return
    yield Finding(
        rule="standards-braking",
        severity=Severity.WARNING,
        subject="standards",
        message=f"a braking rate of {rate:.2f} m/s2",
        detail=f"real trains manage between {low} and {high}",
    )


@rule("standards-overlap", "the overlap holds a train from a stand", Severity.WARNING)
def overlap_is_long_enough(context: Context) -> Iterator[Finding]:
    """An overlap has to hold a train that passed the signal at a low speed."""
    standards = context.scheme.standards
    model = BrakingModel(rate=standards.braking, reaction=standards.reaction)
    wanted = model.stopping_distance(OVERLAP_APPROACH)
    if standards.overlap.metres >= wanted.metres:
        return
    yield Finding(
        rule="standards-overlap",
        severity=Severity.WARNING,
        subject="standards",
        message=(
            f"an overlap of {standards.overlap.metres:.0f}m against "
            f"{wanted.metres:.0f}m to stop from {OVERLAP_APPROACH}"
        ),
        detail="a train that passed the signal would not be held",
    )


@rule("standards-flank", "the flank search covers the layout", Severity.ADVICE)
def flank_search_is_long_enough(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    longest = max((edge.length.metres for edge in scheme.graph.edges.values()), default=0.0)
    if scheme.standards.flank.metres >= longest:
        return
    yield Finding(
        rule="standards-flank",
        severity=Severity.ADVICE,
        subject="standards",
        message=(
            f"the flank search is {scheme.standards.flank.metres:.0f}m and the "
            f"longest edge is {longest:.0f}m"
        ),
        detail="protection further off than that will be reported as missing",
    )


@rule(
    "standards-reduced",
    "the reduced overlap is shorter than the standard one",
    Severity.ERROR,
)
def reduced_overlap_is_shorter(context: Context) -> Iterator[Finding]:
    standards = context.scheme.standards
    if standards.reduced_overlap.metres < standards.overlap.metres:
        return
    yield Finding(
        rule="standards-reduced",
        severity=Severity.ERROR,
        subject="standards",
        message=(
            f"the reduced overlap is {standards.reduced_overlap.metres:.0f}m and "
            f"the standard one is {standards.overlap.metres:.0f}m"
        ),
        detail="one of the two figures is the wrong way round",
    )
