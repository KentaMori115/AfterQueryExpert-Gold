"""Trips: one vehicle running one pattern once, with times at every call.

Times are seconds since the start of the service day, so a trip that leaves at
23:50 and arrives at 00:20 has times 85800 and 87600 and never appears to go
backwards. Arrival and departure are held apart because a train can stand at a
platform, and a connection made on the arrival is not the same as one made on
the departure.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from layover.errors import NetworkError
from layover.times import SECONDS_PER_DAY, TimeWindow, format_clock, parse_clock

__all__ = ["StopCall", "Trip"]


@dataclass(frozen=True)
class StopCall:
    """One call of a trip: where, when it gets in, and when it leaves."""

    stop_id: str
    arrival: int
    departure: int
    index: int

    @property
    def dwell(self) -> int:
        """How long the vehicle stands, in seconds."""
        return self.departure - self.arrival

    def __str__(self) -> str:
        return "%s %s" % (format_clock(self.departure), self.stop_id)


@dataclass(frozen=True)
class Trip:
    """One run of a pattern on the days its service calendar covers.

    ``block_id`` is recorded as written and is not acted on: continuing on the
    same vehicle from one trip to the next is not something the search knows
    about yet.
    """

    trip_id: str
    pattern_id: str
    service_id: str
    arrivals: tuple[int, ...]
    departures: tuple[int, ...]
    headsign: str = ""
    short_name: str = ""
    block_id: Optional[str] = None

    def __post_init__(self) -> None:
        identifier = str(self.trip_id).strip()
        if not identifier:
            raise NetworkError("a trip needs an identifier")
        object.__setattr__(self, "trip_id", identifier)
        if not str(self.pattern_id).strip():
            raise NetworkError("trip %r needs a pattern" % identifier)
        if not str(self.service_id).strip():
            raise NetworkError("trip %r needs a service" % identifier)
        arrivals = tuple(int(value) for value in self.arrivals)
        departures = tuple(int(value) for value in self.departures)
        if len(arrivals) != len(departures):
            raise NetworkError(
                "trip %r has %d arrivals and %d departures"
                % (identifier, len(arrivals), len(departures))
            )
        if len(arrivals) < 2:
            raise NetworkError("trip %r calls at fewer than two stops" % identifier)
        if any(value < 0 for value in arrivals + departures):
            raise NetworkError("trip %r has a time before the service day" % identifier)
        for position, (arrival, departure) in enumerate(zip(arrivals, departures)):
            if departure < arrival:
                raise NetworkError(
                    "trip %r leaves stop %d before it gets there" % (identifier, position)
                )
        for position in range(len(arrivals) - 1):
            if arrivals[position + 1] < departures[position]:
                raise NetworkError(
                    "trip %r goes back in time between stops %d and %d"
                    % (identifier, position, position + 1)
                )
        object.__setattr__(self, "arrivals", arrivals)
        object.__setattr__(self, "departures", departures)
        object.__setattr__(self, "headsign", str(self.headsign).strip())
        object.__setattr__(self, "short_name", str(self.short_name).strip())

    def __len__(self) -> int:
        return len(self.arrivals)

    @property
    def start_time(self) -> int:
        """When the trip leaves its first stop."""
        return self.departures[0]

    @property
    def end_time(self) -> int:
        """When the trip reaches its last stop."""
        return self.arrivals[-1]

    @property
    def duration(self) -> int:
        """How long the whole run takes, in seconds."""
        return self.end_time - self.start_time

    @property
    def window(self) -> TimeWindow:
        """The span of service time the trip occupies."""
        return TimeWindow(self.start_time, self.end_time + 1)

    @property
    def crosses_midnight(self) -> bool:
        """Whether the trip is still running after the service day rolls over."""
        return self.end_time >= SECONDS_PER_DAY

    def arrival_at(self, index: int) -> int:
        """When the trip gets to the call at ``index``."""
        return self.arrivals[self._checked(index)]

    def departure_at(self, index: int) -> int:
        """When the trip leaves the call at ``index``."""
        return self.departures[self._checked(index)]

    def dwell_at(self, index: int) -> int:
        """How long the trip stands at the call at ``index``."""
        position = self._checked(index)
        return self.departures[position] - self.arrivals[position]

    def travel_time(self, start: int, end: int) -> int:
        """How long a passenger is aboard between two calls."""
        first, last = self._checked(start), self._checked(end)
        if last <= first:
            raise NetworkError("trip %r does not run from %d to %d" % (self.trip_id, start, end))
        return self.arrivals[last] - self.departures[first]

    def calls(self, stops: Sequence[str]) -> tuple[StopCall, ...]:
        """Pair the trip's times with the stops of its pattern."""
        if len(stops) != len(self.arrivals):
            raise NetworkError(
                "trip %r has %d times but its pattern has %d stops"
                % (self.trip_id, len(self.arrivals), len(stops))
            )
        return tuple(
            StopCall(stop, self.arrivals[index], self.departures[index], index)
            for index, stop in enumerate(stops)
        )

    def shifted(self, seconds: int) -> "Trip":
        """Return the same run leaving ``seconds`` later."""
        return Trip(
            self.trip_id,
            self.pattern_id,
            self.service_id,
            tuple(value + seconds for value in self.arrivals),
            tuple(value + seconds for value in self.departures),
            self.headsign,
            self.short_name,
            self.block_id,
        )

    def renamed(self, trip_id: str) -> "Trip":
        """Return the same run under another identifier."""
        return Trip(
            trip_id,
            self.pattern_id,
            self.service_id,
            self.arrivals,
            self.departures,
            self.headsign,
            self.short_name,
            self.block_id,
        )

    def _checked(self, index: int) -> int:
        if not 0 <= index < len(self.arrivals):
            raise NetworkError("trip %r has no call at %d" % (self.trip_id, index))
        return index

    def __str__(self) -> str:
        return "%s %s-%s" % (self.trip_id, format_clock(self.start_time), format_clock(self.end_time))

    @classmethod
    def from_times(
        cls,
        trip_id: str,
        pattern_id: str,
        service_id: str,
        times: Iterable,
        headsign: str = "",
        dwell: int = 0,
    ) -> "Trip":
        """Build a trip from clock times, one per call, with an even dwell.

        Each entry is either a clock string, a whole number of seconds, or a
        pair of the two times when the vehicle stands for an uneven length.
        """
        arrivals, departures = [], []
        for entry in times:
            if isinstance(entry, (tuple, list)):
                if len(entry) != 2:
                    raise NetworkError("trip %r has a call that is not a pair" % trip_id)
                arrival, departure = entry
            else:
                arrival = departure = entry
            arrival = arrival if isinstance(arrival, int) else parse_clock(str(arrival))
            departure = departure if isinstance(departure, int) else parse_clock(str(departure))
            if departure == arrival and dwell:
                departure = arrival + dwell
            arrivals.append(arrival)
            departures.append(departure)
        if arrivals:
            departures[-1] = arrivals[-1]
        return cls(trip_id, pattern_id, service_id, tuple(arrivals), tuple(departures), headsign)
