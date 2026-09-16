"""Train protection and berths, which are about what happens when things go wrong.

A signal with no overspeed grid is a signal a train can arrive at too fast to
stop. A grid that would have to sit further back than the signal in rear has
nowhere to go, so somebody has to decide what to do about it rather than the
drawing quietly showing it in the wrong place. And a signal with no berth track
is a signal the signaller cannot see a train waiting at.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.berth import berth_section, without_berths
from ...signalling.tpws import GridKind, grids_for
from ..report import Finding, Severity
from ..rules import Context, rule


@rule("tpws-missing", "fast signals have an overspeed grid", Severity.WARNING)
def signals_have_overspeed_grids(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for signal in scheme.sorted_signals():
        grids = grids_for(scheme, signal)
        if not grids:
            continue
        if any(grid.kind is GridKind.OVERSPEED for grid in grids):
            continue
        speed = scheme.graph.edge(signal.position.edge).speed
        yield Finding(
            rule="tpws-missing",
            severity=Severity.WARNING,
            subject=signal.name,
            message="no overspeed grid",
            detail=f"approach speed {speed}" if speed else "no speed on the track it stands on",
        )


@rule("tpws-room", "overspeed grids fit between the signals", Severity.ERROR)
def overspeed_grids_fit(context: Context) -> Iterator[Finding]:
    """A grid cannot go further back than the signal in rear of the one it protects."""
    scheme = context.scheme
    room = _room_behind(context)

    for signal in scheme.sorted_signals():
        for grid in grids_for(scheme, signal):
            if grid.kind is not GridKind.OVERSPEED:
                continue
            available = room.get(signal.name)
            if available is None or grid.behind.metres <= available:
                continue
            yield Finding(
                rule="tpws-room",
                severity=Severity.ERROR,
                subject=signal.name,
                message=(
                    f"the overspeed grid wants to be {grid.behind.metres:.0f}m in rear, "
                    f"and there is {available:.0f}m of room"
                ),
                detail="the signal in rear is nearer than that",
            )


def _room_behind(context: Context) -> dict[str, float]:
    """How much track there is between each signal and the one behind it."""
    found: dict[str, float] = {}
    for plan in context.plans():
        if not plan.route.exit.is_signal:
            continue
        current = found.get(plan.exit)
        length = plan.route.length.metres
        if current is None or length < current:
            found[plan.exit] = length
    return found


@rule("berth-missing", "every signal has a berth track", Severity.WARNING)
def signals_have_berths(context: Context) -> Iterator[Finding]:
    for name in without_berths(context.scheme):
        yield Finding(
            rule="berth-missing",
            severity=Severity.WARNING,
            subject=name,
            message="no berth track, so a train waiting at it cannot be described",
            detail="there is no detected track in rear of it",
        )


@rule("berth-shared", "two signals do not berth in the same section", Severity.ADVICE)
def berths_are_not_shared(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    seen: dict[str, list[str]] = {}
    for signal in scheme.sorted_signals():
        section = berth_section(scheme, signal.name)
        if section is not None:
            seen.setdefault(section, []).append(signal.name)

    for section, signals in sorted(seen.items()):
        if len(signals) < 2:
            continue
        yield Finding(
            rule="berth-shared",
            severity=Severity.ADVICE,
            subject=section,
            message=f"{len(signals)} signals berth here",
            detail=", ".join(signals),
        )
