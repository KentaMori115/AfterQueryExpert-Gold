"""Berth tracks, and the steps a train describer takes between them.

The berth is the piece of track immediately in rear of a signal, where a train
stands waiting for it. It is what the describer hangs a headcode on, so the
signaller can see which train is where, and it is what an interpose or a cancel
acts on. The steps are the pairs of berths a description moves between when a
train passes a signal.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..topology.position import Position
from ..topology.scheme import Scheme
from ..topology.traverse import walk
from ..units import Distance
from .interlocking import Interlocking

#: How far back to look for the section a train would wait in.
BERTH_SEARCH = Distance(1200.0)


@dataclass(frozen=True)
class Berth:
    """One berth: a signal and the section a train waits in to see it."""

    signal: str
    section: str

    def __str__(self) -> str:
        return f"{self.signal} berths in {self.section}"


@dataclass(frozen=True)
class Step:
    """A description moving from one berth to the next when a signal is passed."""

    from_berth: str
    to_berth: str
    over: str

    def __str__(self) -> str:
        return f"{self.from_berth} -> {self.to_berth} past {self.over}"


def berth_section(
    scheme: Scheme, signal_name: str, *, search: Distance = BERTH_SEARCH
) -> str | None:
    """The section immediately in rear of a signal."""
    signal = scheme.signal(signal_name)
    back = Position(
        signal.position.edge, signal.position.offset, signal.position.sense.opposite
    )

    for step in walk(scheme.graph, back, limit=search):
        if step.remaining(scheme.graph).metres <= 0:
            continue
        section = scheme.sections.name_for(step.edge)
        if section is not None:
            return section
    return None


def berths(scheme: Scheme, *, search: Distance = BERTH_SEARCH) -> list[Berth]:
    """Every signal that has a berth, in name order."""
    found = []
    for signal in scheme.sorted_signals():
        section = berth_section(scheme, signal.name, search=search)
        if section is not None:
            found.append(Berth(signal.name, section))
    return found


def without_berths(scheme: Scheme, *, search: Distance = BERTH_SEARCH) -> list[str]:
    """Signals with nothing behind them for a train to wait in."""
    have = {berth.signal for berth in berths(scheme, search=search)}
    return sorted(name for name in scheme.signals if name not in have)


def steps(scheme: Scheme, interlocking: Interlocking) -> list[Step]:
    """Describer steps, one per route that runs from one berthed signal to another."""
    lookup = {berth.signal: berth.section for berth in berths(scheme)}
    found: list[Step] = []
    for plan in interlocking.sorted_plans():
        if not plan.route.exit.is_signal:
            continue
        start = lookup.get(plan.entrance)
        end = lookup.get(plan.exit)
        if start is None or end is None or start == end:
            continue
        step = Step(start, end, plan.entrance)
        if step not in found:
            found.append(step)
    return found
