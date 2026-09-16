"""Automatic signals: the ones the trains work rather than the signaller.

A signal marked ``automatic yes`` in the plan is not on the panel. Nobody asks
for its route; the route stands set, the signal follows the track ahead of it,
and the whole thing is one less thing for a signaller to do on a plain stretch
of line.

That only works where there is nothing to decide. A signal reading two ways has
to be told which way, and a route that calls a set of points has to have them
moved by something. Both of those need a signaller, so both of them stop a
signal working automatically, and the design is wrong rather than the signal.
Working out which of the declared automatic signals can actually work is
therefore the first thing anything else here wants to know.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from enum import Enum

from ..topology.scheme import Scheme
from .interlocking import Interlocking, RoutePlan


class AutoFault(Enum):
    """Why a signal declared automatic cannot be worked by the trains."""

    NO_ROUTE = "no route"
    CHOICE = "a choice of routes"
    POINTS = "points to move"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class AutoSignal:
    """One signal declared automatic, and what came of it."""

    signal: str
    route: str | None = None
    fault: AutoFault | None = None
    detail: str = ""
    watching: tuple[str, ...] = ()
    """The track that has to be clear before the signal will clear.

    Nobody is going to be told why an automatic signal is at danger, so the
    sections it is watching are worth having written down where the design is
    read rather than worked out again off the control table every time.
    """

    @property
    def works(self) -> bool:
        """Whether the trains really do work this signal."""
        return self.route is not None and self.fault is None

    def __str__(self) -> str:
        if self.works:
            return f"{self.signal} works {self.route}"
        tail = f" ({self.detail})" if self.detail else ""
        return f"{self.signal} cannot work automatically: {self.fault}{tail}"


def _to_move(plan: RoutePlan) -> list[str]:
    """Every set of points the route needs held, whatever it needs them for."""
    wanted = dict(plan.points())
    wanted.update(plan.overlap_points())
    wanted.update(plan.flank_points())
    return sorted(wanted)


def _watching(plan: RoutePlan) -> tuple[str, ...]:
    """The sections the signal proves clear: the route's own, then the overlap."""
    found = list(plan.sections)
    for section in plan.overlap_sections():
        if section not in found:
            found.append(section)
    return tuple(found)


def _decide(signal: str, plans: list[RoutePlan]) -> AutoSignal:
    """What one declared automatic signal comes to."""
    if not plans:
        return AutoSignal(signal, fault=AutoFault.NO_ROUTE)
    if len(plans) > 1:
        return AutoSignal(
            signal,
            fault=AutoFault.CHOICE,
            detail=", ".join(sorted(plan.name for plan in plans)),
        )
    only = plans[0]
    moving = _to_move(only)
    if moving:
        return AutoSignal(signal, fault=AutoFault.POINTS, detail=", ".join(moving))
    return AutoSignal(signal, route=only.name, watching=_watching(only))


class AutomaticWorking:
    """Every automatic signal in a scheme, working or not."""

    def __init__(self, signals: list[AutoSignal]) -> None:
        self.signals = {found.signal: found for found in signals}

    def __len__(self) -> int:
        return len(self.signals)

    def __iter__(self) -> Iterator[AutoSignal]:
        return iter(self.sorted_signals())

    def __contains__(self, signal: object) -> bool:
        return signal in self.signals

    def sorted_signals(self) -> list[AutoSignal]:
        return [self.signals[name] for name in sorted(self.signals)]

    def signal(self, name: str) -> AutoSignal | None:
        return self.signals.get(name)

    def working(self) -> list[AutoSignal]:
        """The ones the trains really do work."""
        return [found for found in self.sorted_signals() if found.works]

    def faults(self) -> list[AutoSignal]:
        """The ones declared automatic that cannot be."""
        return [found for found in self.sorted_signals() if not found.works]

    def routes(self) -> tuple[str, ...]:
        """Every route that stands set without anybody asking for it."""
        return tuple(
            found.route for found in self.working() if found.route is not None
        )

    def route_of(self, signal: str) -> str | None:
        found = self.signals.get(signal)
        return found.route if found is not None and found.works else None

    def signal_of(self, route: str) -> str | None:
        for found in self.working():
            if found.route == route:
                return found.signal
        return None

    def is_automatic(self, route: str) -> bool:
        return route in self.routes()

    def describe(self) -> str:
        working = len(self.working())
        return f"{working} of {len(self.signals)} automatic signals working"


def automatic_working(scheme: Scheme, interlocking: Interlocking) -> AutomaticWorking:
    """Work out which declared automatic signals the trains can be left to."""
    found = [
        _decide(signal.name, interlocking.from_signal(signal.name))
        for signal in scheme.sorted_signals()
        if signal.automatic
    ]
    return AutomaticWorking(found)
