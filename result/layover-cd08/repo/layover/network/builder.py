"""Assembling a network, checking every reference on the way in.

The builder is the only way to make a :class:`~layover.network.network.Network`.
It refuses a trip whose pattern is unknown, a pattern whose stops are not in the
table, a transfer between stops that do not exist, and a trip whose number of
times does not match the length of its pattern. Everything that gets past it can
be read without checking again.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence

from layover.errors import NetworkError
from layover.network.network import Network
from layover.network.patterns import Pattern
from layover.network.routes import Agency, Route
from layover.network.stops import Stop, StopKind
from layover.network.transfers import Transfer, TransferKind
from layover.network.trips import Trip

__all__ = ["NetworkBuilder"]


class NetworkBuilder:
    """Collects the parts of a network and validates them into one."""

    def __init__(self, name: str = "") -> None:
        self.name = name
        self._stops: Dict[str, Stop] = {}
        self._routes: Dict[str, Route] = {}
        self._patterns: Dict[str, Pattern] = {}
        self._trips: Dict[str, Trip] = {}
        self._agencies: Dict[str, Agency] = {}
        self._transfers: List[Transfer] = []

    def add_agency(self, agency: Agency) -> "NetworkBuilder":
        """Take on an agency."""
        self._unique(self._agencies, agency.agency_id, "agency")
        self._agencies[agency.agency_id] = agency
        return self

    def add_stop(self, stop: Stop) -> "NetworkBuilder":
        """Take on a stop, station or entrance."""
        self._unique(self._stops, stop.stop_id, "stop")
        self._stops[stop.stop_id] = stop
        return self

    def add_route(self, route: Route) -> "NetworkBuilder":
        """Take on a route."""
        self._unique(self._routes, route.route_id, "route")
        self._routes[route.route_id] = route
        return self

    def add_pattern(self, pattern: Pattern) -> "NetworkBuilder":
        """Take on a stop pattern."""
        self._unique(self._patterns, pattern.pattern_id, "pattern")
        self._patterns[pattern.pattern_id] = pattern
        return self

    def add_trip(self, trip: Trip) -> "NetworkBuilder":
        """Take on a trip."""
        self._unique(self._trips, trip.trip_id, "trip")
        self._trips[trip.trip_id] = trip
        return self

    def add_transfer(self, transfer: Transfer) -> "NetworkBuilder":
        """Take on a transfer between two stops."""
        self._transfers.append(transfer)
        return self

    def stop(
        self,
        stop_id: str,
        name: str,
        lat=None,
        lon=None,
        parent: Optional[str] = None,
        kind=StopKind.STOP,
        zone: Optional[str] = None,
        platform: Optional[str] = None,
    ) -> "NetworkBuilder":
        """Add a stop from plain values rather than a built object."""
        from layover.geo import Point

        point = None if lat is None or lon is None else Point.of(lat, lon)
        return self.add_stop(Stop(stop_id, name, point, parent, kind, zone, None, platform))

    def route(
        self,
        route_id: str,
        short_name: str,
        long_name: str = "",
        mode="bus",
        agency_id=None,
    ) -> "NetworkBuilder":
        """Add a route from plain values."""
        return self.add_route(Route(route_id, short_name, long_name, mode, agency_id))

    def pattern(
        self,
        pattern_id: str,
        route_id: str,
        stops: Sequence[str],
        headsign: str = "",
        direction: int = 0,
    ) -> "NetworkBuilder":
        """Add a straightforward pattern where a passenger may board throughout."""
        return self.add_pattern(Pattern.straight(pattern_id, route_id, stops, headsign, direction))

    def trip(
        self,
        trip_id: str,
        pattern_id: str,
        service_id: str,
        times: Iterable,
        headsign: str = "",
        dwell: int = 0,
    ) -> "NetworkBuilder":
        """Add a trip from clock times, one per call of its pattern."""
        return self.add_trip(Trip.from_times(trip_id, pattern_id, service_id, times, headsign, dwell))

    def transfer(
        self,
        from_stop: str,
        to_stop: str,
        seconds: int,
        kind=TransferKind.WALK,
        both_ways: bool = True,
    ) -> "NetworkBuilder":
        """Add a transfer, in both directions unless told otherwise."""
        self.add_transfer(Transfer(from_stop, to_stop, seconds, kind))
        if both_ways:
            self.add_transfer(Transfer(to_stop, from_stop, seconds, kind))
        return self

    def station(
        self,
        station_id: str,
        name: str,
        lat=None,
        lon=None,
        platforms: Sequence = (),
    ) -> "NetworkBuilder":
        """Add a station and the platforms inside it in one go.

        Each platform is a name, or a pair of a suffix and a name, and gets an
        identifier of ``station-suffix`` so a feed reader and a hand written
        network agree on what to call it.
        """
        self.stop(station_id, name, lat, lon, kind=StopKind.STATION)
        for entry in platforms:
            suffix, label = entry if isinstance(entry, (tuple, list)) else (entry, entry)
            self.stop(
                "%s-%s" % (station_id, suffix),
                name,
                lat,
                lon,
                parent=station_id,
                platform=str(label),
            )
        return self

    def counts(self) -> dict:
        """How much has been collected so far."""
        return {
            "agencies": len(self._agencies),
            "stops": len(self._stops),
            "routes": len(self._routes),
            "patterns": len(self._patterns),
            "trips": len(self._trips),
            "transfers": len(self._transfers),
        }

    def build(self) -> Network:
        """Check every reference and return the finished network."""
        if not self._stops:
            raise NetworkError("a network needs at least one stop")
        if not self._patterns:
            raise NetworkError("a network needs at least one pattern")
        self._check_stops()
        self._check_patterns()
        self._check_trips()
        self._check_transfers()
        return Network(
            self._stops.values(),
            self._routes.values(),
            self._patterns.values(),
            self._trips.values(),
            tuple(self._transfers),
            self._agencies.values(),
            self.name,
        )

    def _unique(self, holder: Dict, identifier: str, what: str) -> None:
        if identifier in holder:
            raise NetworkError("%s %r is defined twice" % (what, identifier))

    def _check_stops(self) -> None:
        for stop in self._stops.values():
            if stop.parent is None:
                continue
            parent = self._stops.get(stop.parent)
            if parent is None:
                raise NetworkError("stop %r sits inside unknown %r" % (stop.stop_id, stop.parent))
            if not parent.is_station:
                raise NetworkError(
                    "stop %r sits inside %r, which is not a station" % (stop.stop_id, stop.parent)
                )

    def _check_patterns(self) -> None:
        for pattern in self._patterns.values():
            if pattern.route_id not in self._routes:
                raise NetworkError(
                    "pattern %r runs unknown route %r" % (pattern.pattern_id, pattern.route_id)
                )
            for stop_id in pattern.stops:
                stop = self._stops.get(stop_id)
                if stop is None:
                    raise NetworkError(
                        "pattern %r calls at unknown stop %r" % (pattern.pattern_id, stop_id)
                    )
                if not stop.boardable:
                    raise NetworkError(
                        "pattern %r calls at %r, which is a %s"
                        % (pattern.pattern_id, stop_id, stop.kind)
                    )

    def _check_trips(self) -> None:
        for trip in self._trips.values():
            pattern = self._patterns.get(trip.pattern_id)
            if pattern is None:
                raise NetworkError("trip %r runs unknown pattern %r" % (trip.trip_id, trip.pattern_id))
            if len(trip) != len(pattern):
                raise NetworkError(
                    "trip %r has %d times but pattern %r has %d stops"
                    % (trip.trip_id, len(trip), pattern.pattern_id, len(pattern))
                )

    def _check_transfers(self) -> None:
        seen = set()
        for transfer in self._transfers:
            for stop_id in transfer.pair:
                if stop_id not in self._stops:
                    raise NetworkError("transfer names unknown stop %r" % (stop_id,))
            if transfer.pair in seen:
                raise NetworkError(
                    "transfer from %r to %r is declared twice" % transfer.pair
                )
            seen.add(transfer.pair)

    @classmethod
    def from_network(cls, network: Network) -> "NetworkBuilder":
        """Start a builder holding everything an existing network has.

        Useful for making a variant: take the network apart, change one thing,
        and build it again with every reference checked afresh.
        """
        builder = cls(network.name)
        for agency in network.agencies():
            builder.add_agency(agency)
        for stop in network.stops():
            builder.add_stop(stop)
        for route in network.routes():
            builder.add_route(route)
        for pattern in network.patterns():
            builder.add_pattern(pattern)
        for trip in network.trips():
            builder.add_trip(trip)
        for transfer in network.transfers():
            builder.add_transfer(transfer)
        return builder
