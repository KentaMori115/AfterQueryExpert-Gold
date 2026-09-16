"""Capacity: whether the signalling delivers the service it was drawn for.

These are not safety rules. A scheme that fails them is safe and slow, which is
a different kind of problem and one that is much cheaper to find on paper. The
target headway is the one thing here that has to come from outside, so it is
taken from the scheme's own attributes where it is given and left alone where it
is not.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.headway import legs, worst
from ..report import Finding, Severity
from ..rules import Context, rule

#: A block that is much worse than the rest of the line is worth pointing at.
OUT_OF_STEP = 1.6

#: Nothing is said about a scheme with fewer blocks than this; there is no line.
ENOUGH_BLOCKS = 3


@rule("capacity-worst", "no block holds the whole line up", Severity.ADVICE)
def one_block_does_not_spoil_the_line(context: Context) -> Iterator[Finding]:
    found = legs(context.scheme, context.interlocking)
    if len(found) < ENOUGH_BLOCKS:
        return
    slowest = worst(found)
    assert slowest is not None
    others = [leg.seconds for leg in found if leg.route != slowest.route]
    typical = sum(others) / len(others)
    if slowest.seconds < typical * OUT_OF_STEP:
        return
    yield Finding(
        rule="capacity-worst",
        severity=Severity.ADVICE,
        subject=slowest.route,
        message=(
            f"{slowest.seconds:.0f}s headway against {typical:.0f}s for the rest of the line"
        ),
        detail=f"{slowest.length.metres:.0f}m at {slowest.speed}",
    )


@rule("capacity-target", "the line meets its headway target", Severity.WARNING)
def the_target_headway_is_met(context: Context) -> Iterator[Finding]:
    """Compare the worst block against a target, if the scheme names one."""
    target = _target(context)
    if target is None:
        return
    found = legs(context.scheme, context.interlocking)
    slowest = worst(found)
    if slowest is None or slowest.seconds <= target:
        return
    yield Finding(
        rule="capacity-target",
        severity=Severity.WARNING,
        subject=slowest.route,
        message=f"{slowest.seconds:.0f}s headway against a target of {target:.0f}s",
        detail=f"between {slowest.entrance} and {slowest.exit}",
    )


def _target(context: Context) -> float | None:
    """The headway target, in seconds, if any signal on the scheme names one."""
    for signal in context.scheme.sorted_signals():
        raw = signal.attributes.get("headway")
        if raw is None:
            continue
        try:
            return float(raw)
        except ValueError:
            continue
    return None


@rule("capacity-heads", "four aspect signalling is used where it pays", Severity.ADVICE)
def fast_line_is_four_aspect(context: Context) -> Iterator[Finding]:
    """A three aspect signal on fast line costs capacity that a head would buy back."""
    for leg in legs(context.scheme, context.interlocking):
        if leg.heads >= 4 or leg.speed.mph < 70:
            continue
        yield Finding(
            rule="capacity-heads",
            severity=Severity.ADVICE,
            subject=leg.route,
            message=f"{leg.heads} aspect signalling on {leg.speed} line",
            detail=f"{leg.seconds:.0f}s headway over {leg.length.metres:.0f}m",
        )
