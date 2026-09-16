"""The timetable: the network read through a date.

A network holds every trip that ever runs. A timetable answers what runs on one
particular date, which means asking the service calendars and, because a service
day can run past midnight, also asking yesterday. A trip that leaves at 24:50 on
Monday calls at 00:50 on Tuesday and belongs on Tuesday's board.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from layover.errors import PlanError
from layover.network.network import Network
from layover.network.trips import Trip
from layover.services.registry import ServiceRegistry
from layover.timetable.board import BoardEntry
from layover.times import SECONDS_PER_DAY, TimeWindow

__all__ = ["Timetable"]


class Timetable:
    """A network plus its calendars, answering questions about one date."""

    def __init__(self, network: Network, services: ServiceRegistry, days_back: int = 1) -> None:
        if days_back < 0:
            raise PlanError("a timetable cannot look %d days back" % days_back)
        self.network = network
        self.services = services
        self.days_back = days_back
        self._trips: Dict[Tuple[date, str], Tuple[Trip, ...]] = {}

    def services_on(self, day: date) -> tuple[str, ...]:
        """Which services run on a date, sorted."""
        return self.services.active_on(day)

    def trips_on(self, day: date, pattern_id: str) -> tuple[Trip, ...]:
        """Trips of one pattern running on a service date, earliest first."""
        key = (day, pattern_id)
        found = self._trips.get(key)
        if found is None:
            running = set(self.services_on(day))
            found = tuple(
                trip
                for trip in self.network.trips_of_pattern(pattern_id)
                if trip.service_id in running
            )
            self._trips[key] = found
        return found

    def trip_count(self, day: date) -> int:
        """How many trips run on a date, over every pattern."""
        return sum(len(self.trips_on(day, pattern_id)) for pattern_id in self.network.pattern_ids())

    def running_trips(self, day: date) -> tuple[Trip, ...]:
        """Every trip running on a date, earliest departure first."""
        found: List[Trip] = []
        for pattern_id in self.network.pattern_ids():
            found.extend(self.trips_on(day, pattern_id))
        return tuple(sorted(found, key=lambda trip: (trip.start_time, trip.trip_id)))

    def calls_at(
        self,
        stop_id: str,
        day: date,
        window: Optional[TimeWindow] = None,
    ) -> tuple[BoardEntry, ...]:
        """Every call at a stop on a date, yesterday's late trips included."""
        entries: List[BoardEntry] = []
        for offset in range(0, -self.days_back - 1, -1):
            service_day = day + timedelta(days=offset)
            for pattern_id, index in self.network.patterns_at(stop_id):
                pattern = self.network.pattern(pattern_id)
                for trip in self.trips_on(service_day, pattern_id):
                    entry = BoardEntry(stop_id, trip, pattern, index, service_day, offset)
                    if entry.departure < 0 and entry.arrival < 0:
                        continue
                    if offset < 0 and entry.arrival >= SECONDS_PER_DAY:
                        continue
                    if window is not None and not window.contains(entry.departure):
                        continue
                    entries.append(entry)
        return tuple(sorted(entries, key=lambda entry: entry.sort_key()))

    def departures(
        self,
        stop_id: str,
        day: date,
        after: int = 0,
        limit: Optional[int] = None,
        routes: Optional[Iterable[str]] = None,
        modes: Optional[Iterable[str]] = None,
    ) -> tuple[BoardEntry, ...]:
        """The next departures from a stop, in time order.

        Only calls a passenger may board at are returned, and only those leaving
        at or after ``after``.
        """
        wanted_routes = None if routes is None else {str(route) for route in routes}
        wanted_modes = None if modes is None else {str(mode) for mode in modes}
        found = []
        for entry in self.calls_at(stop_id, day):
            if not entry.can_board or entry.departure < after:
                continue
            if wanted_routes is not None and entry.route_id not in wanted_routes:
                continue
            if wanted_modes is not None:
                mode = str(self.network.route(entry.route_id).mode)
                if mode not in wanted_modes:
                    continue
            found.append(entry)
            if limit is not None and len(found) >= limit:
                break
        return tuple(found)

    def arrivals(
        self,
        stop_id: str,
        day: date,
        after: int = 0,
        limit: Optional[int] = None,
    ) -> tuple[BoardEntry, ...]:
        """The next arrivals at a stop, in time order."""
        found = []
        for entry in sorted(
            self.calls_at(stop_id, day), key=lambda item: (item.arrival, item.trip.trip_id)
        ):
            if not entry.can_alight or entry.arrival < after:
                continue
            found.append(entry)
            if limit is not None and len(found) >= limit:
                break
        return tuple(found)

    def next_departure(self, stop_id: str, day: date, after: int = 0) -> Optional[BoardEntry]:
        """The first departure from a stop at or after a time, if there is one."""
        found = self.departures(stop_id, day, after, limit=1)
        return found[0] if found else None

    def last_departure(self, stop_id: str, day: date) -> Optional[BoardEntry]:
        """The final departure from a stop on a date, if there is one."""
        found = self.departures(stop_id, day)
        return found[-1] if found else None

    def headway(self, stop_id: str, day: date, window: TimeWindow) -> Optional[int]:
        """The average gap between departures inside a window, in seconds."""
        times = [
            entry.departure
            for entry in self.departures(stop_id, day)
            if window.contains(entry.departure)
        ]
        if len(times) < 2:
            return None
        return (times[-1] - times[0]) // (len(times) - 1)

    def serves(self, stop_id: str, day: date) -> bool:
        """Whether anything at all calls at a stop on a date."""
        return bool(self.calls_at(stop_id, day))

    def busiest_stop(self, day: date) -> Optional[str]:
        """The stop with the most calls on a date, earliest identifier on a tie."""
        best: Optional[str] = None
        best_count = -1
        for stop_id in self.network.stop_ids():
            count = len(self.calls_at(stop_id, day))
            if count > best_count:
                best, best_count = stop_id, count
        return best if best_count > 0 else None

    def routes_running(self, day: date) -> tuple[str, ...]:
        """Which routes have a trip on a date, sorted."""
        running = set()
        for trip in self.running_trips(day):
            running.add(self.network.pattern(trip.pattern_id).route_id)
        return tuple(sorted(running))

    def first_and_last(self, stop_id: str, day: date) -> Optional[tuple[int, int]]:
        """When the first and last departures of the day leave, if any do."""
        found = self.departures(stop_id, day)
        if not found:
            return None
        return (found[0].departure, found[-1].departure)

    def __str__(self) -> str:
        return "timetable over %s" % self.network
