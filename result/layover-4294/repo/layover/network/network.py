"""The network: every stop, route, pattern, trip and transfer, indexed.

A network is built once by :mod:`layover.network.builder` and then only read.
Everything downstream holds a reference to one and asks it questions, and the
indexes below are what makes those questions cheap: which patterns pass through
a stop, which trips run a pattern, which stops sit inside a station.
"""

from __future__ import annotations

from typing import Dict, Iterable, Iterator, Optional, Tuple

from layover.errors import NetworkError
from layover.geo import BoundingBox
from layover.network.patterns import Pattern
from layover.network.routes import Agency, Route
from layover.network.stops import Stop
from layover.network.transfers import Transfer
from layover.network.trips import Trip

__all__ = ["Network"]


class Network:
    """An immutable timetable network with the indexes a search needs.

    The constructor trusts what it is given. Use
    :class:`~layover.network.builder.NetworkBuilder`, which checks that every
    reference points somewhere before it calls this.
    """

    def __init__(
        self,
        stops: Iterable[Stop],
        routes: Iterable[Route],
        patterns: Iterable[Pattern],
        trips: Iterable[Trip],
        transfers: Iterable[Transfer] = (),
        agencies: Iterable[Agency] = (),
        name: str = "",
    ) -> None:
        self._stops: Dict[str, Stop] = {stop.stop_id: stop for stop in stops}
        self._routes: Dict[str, Route] = {route.route_id: route for route in routes}
        self._patterns: Dict[str, Pattern] = {pattern.pattern_id: pattern for pattern in patterns}
        self._trips: Dict[str, Trip] = {trip.trip_id: trip for trip in trips}
        self._transfers: Tuple[Transfer, ...] = tuple(transfers)
        self._agencies: Dict[str, Agency] = {agency.agency_id: agency for agency in agencies}
        self.name = name
        self._index()

    def _index(self) -> None:
        patterns_at_stop: Dict[str, list] = {}
        for pattern in sorted(self._patterns.values(), key=lambda item: item.pattern_id):
            for position, stop_id in enumerate(pattern.stops):
                patterns_at_stop.setdefault(stop_id, []).append((pattern.pattern_id, position))
        self._patterns_at_stop = {
            stop_id: tuple(entries) for stop_id, entries in patterns_at_stop.items()
        }

        trips_of_pattern: Dict[str, list] = {}
        for trip in self._trips.values():
            trips_of_pattern.setdefault(trip.pattern_id, []).append(trip)
        self._trips_of_pattern = {
            pattern_id: tuple(sorted(entries, key=lambda trip: (trip.start_time, trip.trip_id)))
            for pattern_id, entries in trips_of_pattern.items()
        }

        patterns_of_route: Dict[str, list] = {}
        for pattern in self._patterns.values():
            patterns_of_route.setdefault(pattern.route_id, []).append(pattern.pattern_id)
        self._patterns_of_route = {
            route_id: tuple(sorted(entries)) for route_id, entries in patterns_of_route.items()
        }

        children: Dict[str, list] = {}
        for stop in self._stops.values():
            if stop.parent:
                children.setdefault(stop.parent, []).append(stop.stop_id)
        self._children = {parent: tuple(sorted(entries)) for parent, entries in children.items()}

        transfers_from: Dict[str, list] = {}
        for transfer in self._transfers:
            transfers_from.setdefault(transfer.from_stop, []).append(transfer)
        self._transfers_from = {
            stop_id: tuple(sorted(entries, key=lambda item: (item.seconds, item.to_stop)))
            for stop_id, entries in transfers_from.items()
        }

    def stop(self, stop_id: str) -> Stop:
        """Return one stop, raising if the identifier is unknown."""
        try:
            return self._stops[stop_id]
        except KeyError:
            raise NetworkError("no such stop: %r" % (stop_id,)) from None

    def route(self, route_id: str) -> Route:
        """Return one route, raising if the identifier is unknown."""
        try:
            return self._routes[route_id]
        except KeyError:
            raise NetworkError("no such route: %r" % (route_id,)) from None

    def pattern(self, pattern_id: str) -> Pattern:
        """Return one pattern, raising if the identifier is unknown."""
        try:
            return self._patterns[pattern_id]
        except KeyError:
            raise NetworkError("no such pattern: %r" % (pattern_id,)) from None

    def trip(self, trip_id: str) -> Trip:
        """Return one trip, raising if the identifier is unknown."""
        try:
            return self._trips[trip_id]
        except KeyError:
            raise NetworkError("no such trip: %r" % (trip_id,)) from None

    def agency(self, agency_id: str) -> Agency:
        """Return one agency, raising if the identifier is unknown."""
        try:
            return self._agencies[agency_id]
        except KeyError:
            raise NetworkError("no such agency: %r" % (agency_id,)) from None

    def has_stop(self, stop_id: str) -> bool:
        """Whether a stop identifier is known."""
        return stop_id in self._stops

    def stop_ids(self) -> tuple[str, ...]:
        """Every stop identifier, sorted."""
        return tuple(sorted(self._stops))

    def route_ids(self) -> tuple[str, ...]:
        """Every route identifier, sorted."""
        return tuple(sorted(self._routes))

    def pattern_ids(self) -> tuple[str, ...]:
        """Every pattern identifier, sorted."""
        return tuple(sorted(self._patterns))

    def trip_ids(self) -> tuple[str, ...]:
        """Every trip identifier, sorted."""
        return tuple(sorted(self._trips))

    def agency_ids(self) -> tuple[str, ...]:
        """Every agency identifier, sorted."""
        return tuple(sorted(self._agencies))

    def stops(self) -> tuple[Stop, ...]:
        """Every stop, in identifier order."""
        return tuple(self._stops[stop_id] for stop_id in self.stop_ids())

    def routes(self) -> tuple[Route, ...]:
        """Every route, in identifier order."""
        return tuple(self._routes[route_id] for route_id in self.route_ids())

    def patterns(self) -> tuple[Pattern, ...]:
        """Every pattern, in identifier order."""
        return tuple(self._patterns[pattern_id] for pattern_id in self.pattern_ids())

    def trips(self) -> tuple[Trip, ...]:
        """Every trip, in identifier order."""
        return tuple(self._trips[trip_id] for trip_id in self.trip_ids())

    def transfers(self) -> tuple[Transfer, ...]:
        """Every declared transfer, in the order it was given."""
        return self._transfers

    def agencies(self) -> tuple[Agency, ...]:
        """Every agency, in identifier order."""
        return tuple(self._agencies[agency_id] for agency_id in self.agency_ids())

    def __len__(self) -> int:
        return len(self._stops)

    def __iter__(self) -> Iterator[Stop]:
        return iter(self.stops())

    def __contains__(self, stop_id: object) -> bool:
        return stop_id in self._stops

    def patterns_at(self, stop_id: str) -> tuple[tuple[str, int], ...]:
        """Which patterns call at a stop, and at which position."""
        self.stop(stop_id)
        return self._patterns_at_stop.get(stop_id, ())

    def patterns_of_route(self, route_id: str) -> tuple[str, ...]:
        """Which patterns belong to a route, sorted."""
        self.route(route_id)
        return self._patterns_of_route.get(route_id, ())

    def trips_of_pattern(self, pattern_id: str) -> tuple[Trip, ...]:
        """Trips running a pattern, earliest departure first."""
        self.pattern(pattern_id)
        return self._trips_of_pattern.get(pattern_id, ())

    def trips_of_route(self, route_id: str) -> tuple[Trip, ...]:
        """Trips running any pattern of a route, earliest departure first."""
        found: list = []
        for pattern_id in self.patterns_of_route(route_id):
            found.extend(self._trips_of_pattern.get(pattern_id, ()))
        return tuple(sorted(found, key=lambda trip: (trip.start_time, trip.trip_id)))

    def routes_at(self, stop_id: str) -> tuple[str, ...]:
        """Which routes call at a stop, sorted."""
        routes = {
            self._patterns[pattern_id].route_id for pattern_id, _ in self.patterns_at(stop_id)
        }
        return tuple(sorted(routes))

    def children_of(self, stop_id: str) -> tuple[str, ...]:
        """Stops that sit inside a station, sorted."""
        self.stop(stop_id)
        return self._children.get(stop_id, ())

    def station_of(self, stop_id: str) -> Optional[str]:
        """The station a stop belongs to, or ``None`` if it stands alone."""
        return self.stop(stop_id).parent

    def siblings_of(self, stop_id: str) -> tuple[str, ...]:
        """Other stops in the same station, sorted, the stop itself left out."""
        parent = self.station_of(stop_id)
        if parent is None:
            return ()
        return tuple(child for child in self.children_of(parent) if child != stop_id)

    def transfers_from(self, stop_id: str) -> tuple[Transfer, ...]:
        """Declared transfers leaving a stop, quickest first."""
        self.stop(stop_id)
        return self._transfers_from.get(stop_id, ())

    def transfer_time(self, from_stop: str, to_stop: str) -> Optional[int]:
        """How long the declared transfer between two stops takes, if there is one."""
        if from_stop == to_stop:
            return 0
        for transfer in self.transfers_from(from_stop):
            if transfer.to_stop == to_stop:
                return transfer.seconds
        return None

    def service_ids(self) -> tuple[str, ...]:
        """Every service identifier a trip refers to, sorted."""
        return tuple(sorted({trip.service_id for trip in self._trips.values()}))

    def stops_of_trip(self, trip_id: str) -> tuple[str, ...]:
        """The stops a trip calls at, in order."""
        return self.pattern(self.trip(trip_id).pattern_id).stops

    def bounding_box(self) -> BoundingBox:
        """The box holding every stop that has a position."""
        points = [stop.point for stop in self._stops.values() if stop.point is not None]
        if not points:
            raise NetworkError("no stop in the network has a position")
        return BoundingBox.of(points)

    def counts(self) -> dict:
        """How many of each thing the network holds."""
        return {
            "agencies": len(self._agencies),
            "stops": len(self._stops),
            "routes": len(self._routes),
            "patterns": len(self._patterns),
            "trips": len(self._trips),
            "transfers": len(self._transfers),
        }

    def summary(self) -> str:
        """A one line count of everything, for a report header."""
        counts = self.counts()
        return ", ".join("%d %s" % (counts[key], key) for key in sorted(counts))

    def __str__(self) -> str:
        return "%s: %s" % (self.name or "network", self.summary())
