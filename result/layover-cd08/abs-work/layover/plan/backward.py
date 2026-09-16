"""The backward search: planning from a time you have to be there.

The ordinary search in :mod:`layover.plan.scan` starts where the passenger is
standing and pushes forward, keeping the earliest arrival it has found at every
stop. This one starts at the destination and pulls backward, keeping the latest
moment a passenger may still be at every stop and get there on time. Round one
uses one vehicle, round two uses two, and walking a declared transfer does not
start a round of its own, exactly as in the forward search.

Backward is not forward turned around, and the two places it differs are the
two a reader will look for. A pattern is walked from its last call down to its
first, so the position a passenger gets off at is the one the round enters the
pattern by and the position they get on at is the one it leaves by: the flag
that matters at each end is the opposite of the one the forward search reads.
And a declared transfer runs one way. Walking backward over one means looking
for the walks that END at a stop, which is the index the network does not keep,
so this module builds it once per search.

A change costs the same either way round. ``min_transfer_seconds`` sits between
getting off one vehicle and getting on the next, so backward it is subtracted
from the moment a stop has to be left by, and only when the leg leaving that
stop is a ride. A walk out of a stop needs no buffer, because a walk is not a
vehicle to miss.

The service days are the ones the forward search reads: the date asked about
and the days behind it the timetable keeps. A trip that set off at 24:50 the
night before arrives at 00:50 under the asking date's clock and is a perfectly
good way of being somewhere by one in the morning, so it is offered here the
same way a board offers it.

What the backward pass answers is a moment, not a journey: the latest departure
that still works. The journeys themselves come from the ordinary forward search
run from that moment, which is what stops a passenger being told to leave on
time and then dawdle at every change.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from layover.errors import PlanError
from layover.network.transfers import Transfer
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey, Leg
from layover.plan.scan import JourneySearch
from layover.timetable.table import Timetable
from layover.times import SECONDS_PER_DAY

__all__ = ["BackwardSearch", "plan_arriving_by"]

_NEVER = -(1 << 40)


@dataclass(frozen=True)
class _Reach:
    """How the backward search reached one stop in one round.

    ``departure`` is the latest moment a passenger may leave this stop and
    still make the deadline with the legs this label hangs off. ``leg`` is the
    first of those legs, and ``parent_stop`` is where it ends.
    """

    stop_id: str
    departure: int
    round_number: int
    leg: Optional[Leg] = None
    parent_stop: Optional[str] = None
    parent_round: Optional[int] = None

    @property
    def by_ride(self) -> bool:
        """Whether the passenger leaves this stop on a vehicle."""
        return self.leg is not None and self.leg.is_ride

    def __str__(self) -> str:
        return "%s by %d in round %d" % (self.stop_id, self.departure, self.round_number)


class BackwardSearch:
    """Plans backward from a deadline over a timetable, under one set of settings."""

    def __init__(self, timetable: Timetable, options: Optional[SearchOptions] = None) -> None:
        self.timetable = timetable
        self.options = options or SearchOptions()
        self._alightings: Dict[Tuple[date, str, int], Tuple[tuple, ...]] = {}
        self._walks_in: Optional[Dict[str, Tuple[Transfer, ...]]] = None

    @property
    def network(self):
        """The network being searched."""
        return self.timetable.network

    def plan(self, origin: str, destination: str, day: date, by: int) -> tuple[Journey, ...]:
        """Journeys that leave as late as they can and still arrive in time.

        The latest workable departure is found first, and the journeys are then
        the ones the ordinary forward search offers from that moment, less any
        that would arrive after the deadline.

        Going through the forward search for the last step is what makes this
        an answer a passenger can use. The backward pass knows when to set off
        and nothing else: the legs it hangs off its labels are as late as they
        can be at every step, which is right for working out the moment and
        wrong for printing, because it would have somebody who left on time
        stand about at every change for no reason. Planning forward from that
        moment picks the same departure and the soonest arrival after it, and
        the deadline then drops anything that would turn up late.
        """
        latest = self.latest_departure(origin, destination, day, by)
        if latest is None:
            return ()
        forward = JourneySearch(self.timetable, self.options)
        found = forward.plan(origin, destination, day, latest)
        return tuple(journey for journey in found if journey.arrival <= by)

    def latest_departure(
        self, origin: str, destination: str, day: date, by: int
    ) -> Optional[int]:
        """The last moment a passenger may leave and still be there by ``by``.

        ``None`` when nothing works: no route at all, nothing inside the search
        window, or nothing that fits the limits the settings impose.
        """
        self._check(origin, destination, by)
        rounds = self._search(destination, origin, day, by)
        best: Optional[int] = None
        for labels in rounds:
            label = labels.get(origin)
            if label is None:
                continue
            journey = self._reconstruct(rounds, label)
            if journey is None:
                continue
            if best is None or journey.departure > best:
                best = journey.departure
        return best

    def reaching(self, destination: str, day: date, by: int) -> Dict[str, int]:
        """For every stop that can get there in time, the latest it may be left.

        The destination itself is left out, the way :meth:`JourneySearch.reachable`
        leaves the origin out.
        """
        self._check(None, destination, by)
        rounds = self._search(destination, None, day, by)
        best: Dict[str, int] = {}
        for labels in rounds:
            for stop_id, label in labels.items():
                if stop_id not in best or label.departure > best[stop_id]:
                    best[stop_id] = label.departure
        best.pop(destination, None)
        return best

    def _check(self, origin: Optional[str], destination: str, by: int) -> None:
        if origin is not None and origin == destination:
            raise PlanError("a journey has to go somewhere: %r to itself" % origin)
        if origin is not None:
            self.network.stop(origin)
        self.network.stop(destination)
        if by < 0:
            raise PlanError("a deadline cannot fall before the service day")

    # -- the search ---------------------------------------------------------

    def _search(
        self, destination: str, origin: Optional[str], day: date, by: int
    ) -> List[Dict[str, _Reach]]:
        options = self.options
        horizon = by - options.search_window
        best: Dict[str, int] = {destination: by}
        rounds: List[Dict[str, _Reach]] = [{destination: _Reach(destination, by, 0)}]
        self._walk_to(rounds[0], best, {destination}, 0, horizon)
        marked = set(rounds[0])
        for number in range(1, options.max_rides + 1):
            if not marked:
                break
            current: Dict[str, _Reach] = {}
            previous = rounds[number - 1]
            for pattern_id, start in self._patterns_to_scan(marked, previous):
                self._ride(pattern_id, start, day, previous, current, best, horizon, number)
            improved = set(current)
            self._walk_to(current, best, improved, number, horizon)
            if origin is not None and origin in best:
                horizon = max(horizon, best[origin])
            rounds.append(current)
            marked = set(current)
        return rounds

    def _patterns_to_scan(self, marked, previous) -> tuple[tuple[str, int], ...]:
        """Every pattern worth walking, and the highest call to start it from.

        A backward round enters a pattern where the passenger gets off, so the
        position has to allow alighting and the walk runs down from the last
        such position rather than up from the first.
        """
        latest: Dict[str, int] = {}
        for stop_id in marked:
            if stop_id not in previous:
                continue
            for pattern_id, index in self.network.patterns_at(stop_id):
                pattern = self.network.pattern(pattern_id)
                if not pattern.can_alight(index):
                    continue
                if not self._pattern_allowed(pattern_id):
                    continue
                if pattern_id not in latest or index > latest[pattern_id]:
                    latest[pattern_id] = index
        return tuple(sorted(latest.items()))

    def _pattern_allowed(self, pattern_id: str) -> bool:
        route_id = self.network.pattern(pattern_id).route_id
        if not self.options.allows_route(route_id):
            return False
        return self.options.allows_mode(self.network.route(route_id).mode)

    def _ride(
        self,
        pattern_id: str,
        start: int,
        day: date,
        previous: Dict[str, _Reach],
        current: Dict[str, _Reach],
        best: Dict[str, int],
        horizon: int,
        number: int,
    ) -> None:
        """Walk one pattern from ``start`` down to its first call.

        Two things happen at every position on the way down. If a trip has
        already been picked up further along, this position is somewhere the
        passenger could have got on it, so its departure is the latest they may
        be at this stop and still make the deadline. And if an earlier round
        already reached this stop, this position is somewhere they could get
        off, so the latest trip that arrives in time becomes the one to ride if
        it beats whatever was picked up before.
        """
        pattern = self.network.pattern(pattern_id)
        route_id = pattern.route_id
        riding: Optional[tuple] = None
        alight_index = 0
        alight_time = 0
        for index in range(start, -1, -1):
            stop_id = pattern.stops[index]
            if riding is not None and pattern.can_board(index):
                trip, offset = riding[1], riding[2]
                departure = trip.departure_at(index) + offset * SECONDS_PER_DAY
                if departure > best.get(stop_id, _NEVER) and departure >= horizon:
                    best[stop_id] = departure
                    current[stop_id] = _Reach(
                        stop_id,
                        departure,
                        number,
                        Leg.ride(
                            stop_id,
                            pattern.stops[alight_index],
                            departure,
                            alight_time,
                            route_id,
                            trip.trip_id,
                            pattern_id,
                            trip.headsign or pattern.headsign,
                            pattern.stops[index + 1 : alight_index],
                        ),
                        pattern.stops[alight_index],
                        number - 1,
                    )
            label = previous.get(stop_id)
            if label is None or not pattern.can_alight(index):
                continue
            ready = label.departure - (self.options.min_transfer_seconds if label.by_ride else 0)
            if ready < horizon:
                continue
            candidate = self._latest_alighting(day, pattern_id, index, ready)
            if candidate is None:
                continue
            if riding is None or candidate[0] > riding[0]:
                riding = candidate
                alight_index = index
                alight_time = candidate[0]

    def _walk_to(
        self,
        labels: Dict[str, _Reach],
        best: Dict[str, int],
        improved,
        number: int,
        horizon: int,
    ) -> None:
        """Follow every declared transfer that ends at a stop the round reached.

        A transfer runs one way, from the stop it was declared at to the stop
        it was declared to, and walking one backward means starting from the
        second and arriving at the first. Which is why this reads the index
        keyed by where a walk ends rather than the one the network keeps.
        """
        additions: Dict[str, _Reach] = {}
        for stop_id in sorted(improved):
            label = labels.get(stop_id)
            if label is None:
                continue
            for transfer in self._transfers_to(stop_id):
                if not self.options.allows_walk(transfer.seconds):
                    continue
                departure = label.departure - transfer.seconds
                source = transfer.from_stop
                if departure < horizon:
                    continue
                if departure <= best.get(source, _NEVER):
                    continue
                existing = additions.get(source)
                if existing is not None and existing.departure >= departure:
                    continue
                best[source] = departure
                additions[source] = _Reach(
                    source,
                    departure,
                    number,
                    Leg.walk(source, stop_id, departure, label.departure),
                    stop_id,
                    number,
                )
        labels.update(additions)

    def _transfers_to(self, stop_id: str) -> tuple[Transfer, ...]:
        """Declared transfers arriving at a stop, quickest first.

        The network indexes transfers by where they start, because that is what
        the forward search asks for. This is the other index, built once and
        held for the life of the search.
        """
        if self._walks_in is None:
            collected: Dict[str, List[Transfer]] = {}
            for transfer in self.network.transfers():
                collected.setdefault(transfer.to_stop, []).append(transfer)
            self._walks_in = {
                target: tuple(sorted(entries, key=lambda item: (item.seconds, item.from_stop)))
                for target, entries in collected.items()
            }
        return self._walks_in.get(stop_id, ())

    def _latest_alighting(
        self, day: date, pattern_id: str, index: int, ready: int
    ) -> Optional[tuple]:
        """The last trip of a pattern that reaches one call by ``ready``.

        The arrivals are sorted, so this is the entry before the first one that
        lands too late. A trip arriving exactly at ``ready`` is in time. What is
        left of the window is not checked here: every departure this trip could
        be boarded at is tested against the horizon by the caller, and a trip
        that fell outside it makes no label anywhere.
        """
        entries = self._alightings_at(day, pattern_id, index)
        low, high = 0, len(entries)
        while low < high:
            middle = (low + high) // 2
            if entries[middle][0] <= ready:
                low = middle + 1
            else:
                high = middle
        if low == 0:
            return None
        return entries[low - 1]

    def _alightings_at(self, day: date, pattern_id: str, index: int) -> tuple[tuple, ...]:
        """Every arrival at one call of one pattern, earliest first.

        The service days this looks at are the ones the forward search looks
        at: the date asked about and the days behind it the timetable keeps, so
        a trip that left before midnight and arrives after it is offered here
        under the arriving date's clock.
        """
        key = (day, pattern_id, index)
        found = self._alightings.get(key)
        if found is None:
            entries = []
            for offset in range(0, -self.timetable.days_back - 1, -1):
                service_day = day + timedelta(days=offset)
                for trip in self.timetable.trips_on(service_day, pattern_id):
                    arrival = trip.arrival_at(index) + offset * SECONDS_PER_DAY
                    if arrival < 0:
                        continue
                    entries.append((arrival, trip, offset))
            entries.sort(key=lambda entry: (entry[0], entry[1].trip_id))
            found = tuple(entries)
            self._alightings[key] = found
        return found

    def _reconstruct(self, rounds: List[Dict[str, _Reach]], label: _Reach) -> Optional[Journey]:
        """Follow a label to the deadline, collecting legs in travelling order."""
        legs: List[Leg] = []
        current: Optional[_Reach] = label
        seen = 0
        while current is not None and current.leg is not None:
            legs.append(current.leg)
            if current.parent_stop is None or current.parent_round is None:
                break
            parent = rounds[current.parent_round].get(current.parent_stop)
            if parent is None or parent is current:
                break
            current = parent
            seen += 1
            if seen > 2 * (self.options.max_rides + 2):
                raise PlanError("a reconstructed journey loops")
        if not legs:
            return None
        try:
            return Journey(tuple(legs))
        except PlanError:
            return None

    def __str__(self) -> str:
        return "backward search over %s" % self.timetable


def plan_arriving_by(
    timetable: Timetable,
    origin: str,
    destination: str,
    day: date,
    by: int,
    options: Optional[SearchOptions] = None,
) -> tuple[Journey, ...]:
    """Plan from one stop to another, arriving at or before a time."""
    return BackwardSearch(timetable, options).plan(origin, destination, day, by)
