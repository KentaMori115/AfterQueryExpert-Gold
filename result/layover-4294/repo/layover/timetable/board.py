"""What a departure board holds: one call of one trip at one stop.

A board entry knows which service day it came from as well as when it happens
on the day being asked about. A tram that left at 24:50 yesterday and calls here
at 00:55 today is a real departure today, and the entry says both times so a
report can print the one a passenger wants and a test can check the other.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from layover.network.patterns import Pattern
from layover.network.trips import Trip
from layover.times import SECONDS_PER_DAY, format_clock, format_short

__all__ = ["BoardEntry"]


@dataclass(frozen=True)
class BoardEntry:
    """One call of one trip at one stop, seen from a particular date."""

    stop_id: str
    trip: Trip
    pattern: Pattern
    index: int
    service_date: date
    day_offset: int

    @property
    def trip_id(self) -> str:
        """Which trip this is."""
        return self.trip.trip_id

    @property
    def route_id(self) -> str:
        """Which route the trip runs."""
        return self.pattern.route_id

    @property
    def service_arrival(self) -> int:
        """When the trip gets here, as its own service day writes it."""
        return self.trip.arrival_at(self.index)

    @property
    def service_departure(self) -> int:
        """When the trip leaves, as its own service day writes it."""
        return self.trip.departure_at(self.index)

    @property
    def arrival(self) -> int:
        """When the trip gets here, on the date the board was asked for."""
        return self.service_arrival + self.day_offset * SECONDS_PER_DAY

    @property
    def departure(self) -> int:
        """When the trip leaves, on the date the board was asked for."""
        return self.service_departure + self.day_offset * SECONDS_PER_DAY

    @property
    def board_date(self) -> date:
        """The date the board was asked for."""
        return self.service_date - timedelta(days=self.day_offset)

    @property
    def headsign(self) -> str:
        """Where the vehicle says it is going."""
        return self.trip.headsign or self.pattern.headsign

    @property
    def destination(self) -> str:
        """The last stop the trip calls at."""
        return self.pattern.destination

    @property
    def is_origin(self) -> bool:
        """Whether the trip starts here."""
        return self.index == 0

    @property
    def is_destination(self) -> bool:
        """Whether the trip ends here."""
        return self.index == len(self.pattern) - 1

    @property
    def can_board(self) -> bool:
        """Whether a passenger may get on."""
        return self.pattern.can_board(self.index)

    @property
    def can_alight(self) -> bool:
        """Whether a passenger may get off."""
        return self.pattern.can_alight(self.index)

    @property
    def from_yesterday(self) -> bool:
        """Whether the trip started on the service day before this one."""
        return self.day_offset < 0

    def stops_after(self) -> tuple[str, ...]:
        """The stops the trip still has to call at."""
        return self.pattern.stops[self.index + 1 :]

    def sort_key(self) -> tuple:
        """The order a board puts entries in: by time, then trip."""
        return (self.departure, self.arrival, self.trip.trip_id)

    def describe(self, short: bool = True) -> str:
        """One line: the time, the route and where it is going."""
        clock = format_short if short else format_clock
        target = self.headsign or self.destination
        return "%s %s %s" % (clock(self.departure), self.route_id, target)

    def __str__(self) -> str:
        return self.describe()
