"""A pattern's trips laid out as a grid: stops down the side, trips across.

This is the shape a printed timetable has. The grid holds times and nothing
else; turning it into a table of text, a markdown block or a comma separated
file is the report layer's job.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional, Tuple

from layover.errors import PlanError
from layover.timetable.table import Timetable
from layover.times import TimeWindow, format_short

__all__ = ["Grid", "pattern_grid", "route_grids"]


@dataclass(frozen=True)
class Grid:
    """Departure times for one pattern: a row per stop, a column per trip."""

    pattern_id: str
    route_id: str
    stops: Tuple[str, ...]
    trips: Tuple[str, ...]
    times: Tuple[Tuple[Optional[int], ...], ...]
    headsign: str = ""

    def __post_init__(self) -> None:
        if len(self.times) != len(self.stops):
            raise PlanError("a grid needs one row per stop")
        for row in self.times:
            if len(row) != len(self.trips):
                raise PlanError("a grid needs one time per trip in every row")

    @property
    def is_empty(self) -> bool:
        """Whether the grid has no trips at all."""
        return not self.trips

    def column(self, trip_id: str) -> tuple[Optional[int], ...]:
        """One trip's times down the pattern."""
        try:
            index = self.trips.index(trip_id)
        except ValueError:
            raise PlanError("grid %r has no trip %r" % (self.pattern_id, trip_id)) from None
        return tuple(row[index] for row in self.times)

    def row(self, stop_id: str) -> tuple[Optional[int], ...]:
        """One stop's times across the trips."""
        try:
            index = self.stops.index(stop_id)
        except ValueError:
            raise PlanError("grid %r has no stop %r" % (self.pattern_id, stop_id)) from None
        return self.times[index]

    def first_departure(self) -> Optional[int]:
        """When the earliest trip leaves the first stop."""
        times = [time for time in self.times[0] if time is not None] if self.times else []
        return min(times) if times else None

    def last_departure(self) -> Optional[int]:
        """When the latest trip leaves the first stop."""
        times = [time for time in self.times[0] if time is not None] if self.times else []
        return max(times) if times else None

    def limited(self, count: int) -> "Grid":
        """Return the grid with only the first ``count`` trips."""
        if count < 0:
            raise PlanError("a grid cannot be cut to %d trips" % count)
        return Grid(
            self.pattern_id,
            self.route_id,
            self.stops,
            self.trips[:count],
            tuple(row[:count] for row in self.times),
            self.headsign,
        )

    def as_text_rows(self) -> tuple[tuple[str, ...], ...]:
        """The grid as strings, blank where a trip does not call."""
        return tuple(
            tuple("" if time is None else format_short(time) for time in row)
            for row in self.times
        )

    def __str__(self) -> str:
        return "%s: %d stops by %d trips" % (self.pattern_id, len(self.stops), len(self.trips))


def pattern_grid(
    timetable: Timetable,
    pattern_id: str,
    day: date,
    window: Optional[TimeWindow] = None,
    limit: Optional[int] = None,
) -> Grid:
    """Lay out the trips of one pattern on a date."""
    pattern = timetable.network.pattern(pattern_id)
    trips = [
        trip
        for trip in timetable.trips_on(day, pattern_id)
        if window is None or window.contains(trip.start_time)
    ]
    if limit is not None:
        trips = trips[:limit]
    times = tuple(
        tuple(trip.departure_at(index) for trip in trips) for index in range(len(pattern))
    )
    return Grid(
        pattern_id,
        pattern.route_id,
        pattern.stops,
        tuple(trip.trip_id for trip in trips),
        times,
        pattern.headsign,
    )


def route_grids(
    timetable: Timetable,
    route_id: str,
    day: date,
    window: Optional[TimeWindow] = None,
) -> tuple[Grid, ...]:
    """One grid per pattern of a route, patterns in identifier order.

    Patterns are kept apart rather than merged. Two patterns of the same route
    call at different stops, and a merged grid would have to invent a stop order
    that no vehicle actually runs.
    """
    return tuple(
        pattern_grid(timetable, pattern_id, day, window)
        for pattern_id in timetable.network.patterns_of_route(route_id)
    )
