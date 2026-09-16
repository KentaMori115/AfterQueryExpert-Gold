"""What happened, in order, with enough structure to be searched.

A simulation that only prints lines is no use for arguing about. Every event
knows what kind of thing it was and what it was about, so that a run can be
asked whether a particular signal ever cleared, or how long a train stood at it.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import Enum


class EventKind(Enum):
    TRAIN = "train"
    ROUTE = "route"
    SIGNAL = "signal"
    POINTS = "points"
    TRACK = "track"
    NOTE = "note"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Event:
    """One thing that happened at one time."""

    at: float
    kind: EventKind
    subject: str
    message: str

    def __str__(self) -> str:
        return f"{self.at:7.1f}s {self.kind.value:6s} {self.subject:8s} {self.message}"


@dataclass
class EventLog:
    """Everything that happened, in the order it happened."""

    events: list[Event] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.events)

    def __iter__(self) -> Iterator[Event]:
        return iter(self.events)

    def __bool__(self) -> bool:
        return bool(self.events)

    def add(self, at: float, kind: EventKind, subject: str, message: str) -> Event:
        event = Event(at, kind, subject, message)
        self.events.append(event)
        return event

    def of(self, kind: EventKind) -> list[Event]:
        return [event for event in self.events if event.kind is kind]

    def about(self, subject: str) -> list[Event]:
        return [event for event in self.events if event.subject == subject]

    def between(self, start: float, end: float) -> list[Event]:
        return [event for event in self.events if start <= event.at <= end]

    def mentioning(self, text: str) -> list[Event]:
        return [event for event in self.events if text in event.message]

    def last(self) -> Event | None:
        return self.events[-1] if self.events else None

    def text(self) -> str:
        return "\n".join(str(event) for event in self.events) + ("\n" if self.events else "")

    def summary(self) -> str:
        if not self.events:
            return "nothing happened"
        counts = {kind: len(self.of(kind)) for kind in EventKind}
        parts = [f"{count} {kind}" for kind, count in counts.items() if count]
        span = self.events[-1].at - self.events[0].at
        return f"{len(self.events)} events over {span:.0f}s: " + ", ".join(parts)
