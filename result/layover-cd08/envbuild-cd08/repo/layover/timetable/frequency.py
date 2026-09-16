"""How often something runs, which is not the same as when it runs.

A passenger who knows the timetable asks when the next one leaves. A passenger
who does not asks how long they will be standing there. This module answers the
second question: how many departures inside a window, how far apart they are,
and whether the gaps are even enough to turn up without looking.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, List, Optional, Tuple

from layover.errors import PlanError
from layover.timetable.table import Timetable
from layover.times import SECONDS_PER_HOUR, TimeWindow, format_duration, format_short

__all__ = ["Frequency", "busiest_window", "route_frequency", "service_profile", "stop_frequency"]

EVEN_ENOUGH = 120


@dataclass(frozen=True)
class Frequency:
    """How often departures happen inside one window."""

    subject: str
    window: TimeWindow
    times: Tuple[int, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "times", tuple(sorted(self.times)))

    @property
    def count(self) -> int:
        """How many departures there are."""
        return len(self.times)

    @property
    def first(self) -> Optional[int]:
        """The first departure, or ``None`` if there is none."""
        return self.times[0] if self.times else None

    @property
    def last(self) -> Optional[int]:
        """The last departure, or ``None`` if there is none."""
        return self.times[-1] if self.times else None

    def gaps(self) -> tuple[int, ...]:
        """The waits between one departure and the next."""
        return tuple(
            second - first for first, second in zip(self.times, self.times[1:])
        )

    @property
    def mean_headway(self) -> Optional[int]:
        """The average gap between departures, or ``None`` if there is one or none."""
        gaps = self.gaps()
        if not gaps:
            return None
        return sum(gaps) // len(gaps)

    @property
    def longest_gap(self) -> Optional[int]:
        """The longest wait between two departures."""
        gaps = self.gaps()
        return max(gaps) if gaps else None

    @property
    def shortest_gap(self) -> Optional[int]:
        """The shortest wait between two departures."""
        gaps = self.gaps()
        return min(gaps) if gaps else None

    @property
    def per_hour(self) -> int:
        """How many departures an hour, rounded down."""
        if self.window.length <= 0:
            return 0
        return self.count * SECONDS_PER_HOUR // self.window.length

    def is_even(self, tolerance: int = EVEN_ENOUGH) -> bool:
        """Whether the gaps are close enough to turn up without a timetable."""
        gaps = self.gaps()
        if len(gaps) < 2:
            return False
        return max(gaps) - min(gaps) <= tolerance

    def describe(self) -> str:
        """One line: how many, how often, and how long the worst wait is."""
        if not self.count:
            return "nothing between %s" % self.window
        if self.mean_headway is None:
            return "one departure, at %s" % format_short(self.times[0])
        return "%d departures, one every %s, worst wait %s" % (
            self.count,
            format_duration(self.mean_headway),
            format_duration(self.longest_gap or 0),
        )

    def __str__(self) -> str:
        return "%s: %s" % (self.subject, self.describe())


def stop_frequency(
    timetable: Timetable,
    stop_id: str,
    day: date,
    window: TimeWindow,
    routes: Optional[Iterable[str]] = None,
) -> Frequency:
    """How often anything leaves a stop inside a window."""
    entries = timetable.departures(stop_id, day, window.start, None, routes)
    times = [entry.departure for entry in entries if window.contains(entry.departure)]
    return Frequency(stop_id, window, tuple(times))


def route_frequency(
    timetable: Timetable,
    route_id: str,
    day: date,
    window: TimeWindow,
    direction: Optional[int] = None,
) -> Frequency:
    """How often a route leaves the first stop of its patterns inside a window."""
    network = timetable.network
    times: List[int] = []
    for pattern_id in network.patterns_of_route(route_id):
        pattern = network.pattern(pattern_id)
        if direction is not None and pattern.direction != direction:
            continue
        for trip in timetable.trips_on(day, pattern_id):
            if window.contains(trip.start_time):
                times.append(trip.start_time)
    return Frequency(route_id, window, tuple(times))


def service_profile(
    timetable: Timetable,
    stop_id: str,
    day: date,
    window: Optional[TimeWindow] = None,
    step: int = SECONDS_PER_HOUR,
) -> tuple[Frequency, ...]:
    """Break a day at one stop into equal slices and count each one."""
    if step <= 0:
        raise PlanError("a profile step has to move forward, got %d" % step)
    whole = window or TimeWindow.of_day()
    found = []
    for start in whole.minutes(step):
        slice_window = TimeWindow(start, min(start + step, whole.end))
        found.append(stop_frequency(timetable, stop_id, day, slice_window))
    return tuple(found)


def busiest_window(
    timetable: Timetable,
    stop_id: str,
    day: date,
    step: int = SECONDS_PER_HOUR,
) -> Optional[Frequency]:
    """The slice of the day with the most departures, earliest one on a tie."""
    best: Optional[Frequency] = None
    for slice_frequency in service_profile(timetable, stop_id, day, None, step):
        if best is None or slice_frequency.count > best.count:
            best = slice_frequency
    if best is None or not best.count:
        return None
    return best
