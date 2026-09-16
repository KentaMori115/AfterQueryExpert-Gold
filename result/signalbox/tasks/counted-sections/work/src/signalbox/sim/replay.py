"""Playing a recorded run back, which is how a simulation gets argued about.

A run produces a history and a log. Replaying them together gives the state of
the railway at any moment: where the trains were, what was occupied, and what
had happened up to then. That is what a review of a simulation actually needs,
and it is much cheaper than running the whole thing again to get to one moment.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..topology.scheme import Scheme
from .history import Fix, History
from .log import Event, EventLog


@dataclass(frozen=True)
class Moment:
    """The railway at one instant, as far as the record shows."""

    at: float
    fixes: tuple[Fix, ...] = ()
    events: tuple[Event, ...] = ()

    @property
    def trains(self) -> tuple[str, ...]:
        return tuple(fix.train for fix in self.fixes)

    def fix(self, train: str) -> Fix | None:
        for found in self.fixes:
            if found.train == train:
                return found
        return None

    def moving(self) -> tuple[str, ...]:
        return tuple(fix.train for fix in self.fixes if fix.speed.moving)

    def standing(self) -> tuple[str, ...]:
        return tuple(fix.train for fix in self.fixes if fix.speed.stopped)

    def sections(self, scheme: Scheme) -> tuple[str, ...]:
        """The sections the fixes put a train on, without repeats."""
        found: list[str] = []
        for fix in self.fixes:
            name = scheme.sections.name_for(fix.edge)
            if name is not None and name not in found:
                found.append(name)
        return tuple(sorted(found))

    def __str__(self) -> str:
        return f"{self.at:.0f}s: {len(self.fixes)} trains, {len(self.events)} events"


@dataclass
class Replay:
    """A run, ready to be asked what was happening when."""

    history: History
    log: EventLog = field(default_factory=EventLog)

    @property
    def span(self) -> tuple[float, float]:
        return self.history.span()

    def at(self, when: float) -> Moment:
        """The state as it was at ``when``, and what had just happened."""
        start, _end = self.span
        previous = max(start, when - 1e-9)
        events = tuple(
            event for event in self.log if previous < event.at <= when or event.at == when
        )
        return Moment(when, tuple(self.history.at(when)), events)

    def moments(self, every: float) -> list[Moment]:
        """A moment every so many seconds, from the start of the run to the end."""
        if every <= 0:
            raise ValueError("moments have to be taken at a positive interval")
        start, end = self.span
        found: list[Moment] = []
        when = start
        while when <= end:
            found.append(self.at(when))
            when += every
        return found

    def when_train_stopped(self, train: str) -> list[float]:
        return [fix.at for fix in self.history.stops(train)]

    def summary(self) -> str:
        start, end = self.span
        return f"{len(self.history)} fixes and {len(self.log)} events over {end - start:.0f}s"
