"""The journey search: rounds of riding, each round one more change.

The search is the round based kind. Round one finds everywhere reachable on a
single vehicle from where the passenger is standing, round two everywhere
reachable with one change, and so on up to the limit. Each round ends by walking
the declared transfers, which does not count as a change of vehicle by itself.

Two things make it terminate and stay fast: a stop is only worth revisiting if
this round gets there earlier than every round before it, and a pattern is
scanned once per round from the earliest position any marked stop sits at.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from layover.errors import PlanError
from layover.network.trips import Trip
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey, Leg
from layover.timetable.table import Timetable
from layover.times import SECONDS_PER_DAY

__all__ = ["JourneySearch", "Label"]

_FOREVER = 1 << 40


@dataclass(frozen=True)
class Label:
    """How the search reached one stop in one round."""

    stop_id: str
    arrival: int
    round_number: int
    leg: Optional[Leg] = None
    parent_stop: Optional[str] = None
    parent_round: Optional[int] = None

    @property
    def by_ride(self) -> bool:
        """Whether the passenger got here on a vehicle."""
        return self.leg is not None and self.leg.is_ride

    def __str__(self) -> str:
        return "%s at %d in round %d" % (self.stop_id, self.arrival, self.round_number)


class JourneySearch:
    """Plans journeys over a timetable under one set of settings."""

    def __init__(self, timetable: Timetable, options: Optional[SearchOptions] = None) -> None:
        self.timetable = timetable
        self.options = options or SearchOptions()
        self._boardings: Dict[Tuple[date, str, int], Tuple[tuple, ...]] = {}

    @property
    def network(self):
        """The network being searched."""
        return self.timetable.network

    def plan(self, origin: str, destination: str, day: date, after: int = 0) -> tuple[Journey, ...]:
        """Find the journeys worth offering from one stop to another."""
        if origin == destination:
            raise PlanError("a journey has to go somewhere: %r to itself" % origin)
        self.network.stop(origin)
        self.network.stop(destination)
        if after < 0:
            raise PlanError("a search cannot start before the service day")
        rounds = self._search(origin, destination, day, after)
        found = []
        for number, labels in enumerate(rounds):
            label = labels.get(destination)
            if label is None:
                continue
            journey = self._reconstruct(rounds, label)
            if journey is not None:
                found.append(journey)
        return self._best(found)

    def earliest_arrival(self, origin: str, destination: str, day: date, after: int = 0) -> Optional[int]:
        """When the first possible arrival is, or ``None`` if there is none."""
        journeys = self.plan(origin, destination, day, after)
        return journeys[0].arrival if journeys else None

    def reachable(self, origin: str, day: date, after: int = 0) -> Dict[str, int]:
        """The earliest arrival at every stop reachable from one, by any route."""
        rounds = self._search(origin, None, day, after)
        best: Dict[str, int] = {}
        for labels in rounds:
            for stop_id, label in labels.items():
                if stop_id not in best or label.arrival < best[stop_id]:
                    best[stop_id] = label.arrival
        best.pop(origin, None)
        return best

    def _search(
        self, origin: str, destination: Optional[str], day: date, after: int
    ) -> List[Dict[str, Label]]:
        options = self.options
        deadline = after + options.search_window
        best: Dict[str, int] = {origin: after}
        rounds: List[Dict[str, Label]] = [{origin: Label(origin, after, 0)}]
        self._walk_from(rounds[0], best, {origin}, 0)
        marked = set(rounds[0])
        for number in range(1, options.max_rides + 1):
            if not marked:
                break
            current: Dict[str, Label] = {}
            previous = rounds[number - 1]
            for pattern_id, start in self._patterns_to_scan(marked, previous):
                self._ride(pattern_id, start, day, previous, current, best, deadline, number)
            improved = set(current)
            self._walk_from(current, best, improved, number)
            if destination is not None and destination in best:
                deadline = min(deadline, best[destination])
            rounds.append(current)
            marked = set(current)
        return rounds

    def _patterns_to_scan(self, marked, previous) -> tuple[tuple[str, int], ...]:
        earliest: Dict[str, int] = {}
        for stop_id in marked:
            if stop_id not in previous:
                continue
            for pattern_id, index in self.network.patterns_at(stop_id):
                pattern = self.network.pattern(pattern_id)
                if not pattern.can_board(index):
                    continue
                if not self._pattern_allowed(pattern_id):
                    continue
                if pattern_id not in earliest or index < earliest[pattern_id]:
                    earliest[pattern_id] = index
        return tuple(sorted(earliest.items()))

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
        previous: Dict[str, Label],
        current: Dict[str, Label],
        best: Dict[str, int],
        deadline: int,
        number: int,
    ) -> None:
        pattern = self.network.pattern(pattern_id)
        route_id = pattern.route_id
        riding: Optional[tuple] = None
        board_index = 0
        board_time = 0
        for index in range(start, len(pattern)):
            stop_id = pattern.stops[index]
            if riding is not None and pattern.can_alight(index):
                trip, offset = riding[1], riding[2]
                arrival = trip.arrival_at(index) + offset * SECONDS_PER_DAY
                if arrival < best.get(stop_id, _FOREVER) and arrival <= deadline:
                    best[stop_id] = arrival
                    current[stop_id] = Label(
                        stop_id,
                        arrival,
                        number,
                        Leg.ride(
                            pattern.stops[board_index],
                            stop_id,
                            board_time,
                            arrival,
                            route_id,
                            trip.trip_id,
                            pattern_id,
                            trip.headsign or pattern.headsign,
                            pattern.stops[board_index + 1 : index],
                        ),
                        pattern.stops[board_index],
                        number - 1,
                    )
            label = previous.get(stop_id)
            if label is None or not pattern.can_board(index):
                continue
            ready = label.arrival + (self.options.min_transfer_seconds if label.by_ride else 0)
            if ready > deadline:
                continue
            candidate = self._earliest_boarding(day, pattern_id, index, ready, deadline)
            if candidate is None:
                continue
            if riding is None or candidate[0] < riding[0]:
                riding = candidate
                board_index = index
                board_time = candidate[0]

    def _walk_from(
        self,
        labels: Dict[str, Label],
        best: Dict[str, int],
        improved,
        number: int,
    ) -> None:
        additions: Dict[str, Label] = {}
        for stop_id in sorted(improved):
            label = labels.get(stop_id)
            if label is None:
                continue
            for transfer in self.network.transfers_from(stop_id):
                if not self.options.allows_walk(transfer.seconds):
                    continue
                arrival = label.arrival + transfer.seconds
                target = transfer.to_stop
                if arrival >= best.get(target, _FOREVER):
                    continue
                existing = additions.get(target)
                if existing is not None and existing.arrival <= arrival:
                    continue
                best[target] = arrival
                additions[target] = Label(
                    target,
                    arrival,
                    number,
                    Leg.walk(stop_id, target, label.arrival, arrival),
                    stop_id,
                    number,
                )
        labels.update(additions)

    def _earliest_boarding(
        self, day: date, pattern_id: str, index: int, ready: int, deadline: int
    ) -> Optional[tuple]:
        entries = self._boardings_at(day, pattern_id, index)
        low, high = 0, len(entries)
        while low < high:
            middle = (low + high) // 2
            if entries[middle][0] < ready:
                low = middle + 1
            else:
                high = middle
        if low >= len(entries):
            return None
        found = entries[low]
        if found[0] > deadline:
            return None
        return found

    def _boardings_at(self, day: date, pattern_id: str, index: int) -> tuple[tuple, ...]:
        key = (day, pattern_id, index)
        found = self._boardings.get(key)
        if found is None:
            entries = []
            for offset in range(0, -self.timetable.days_back - 1, -1):
                service_day = day + timedelta(days=offset)
                for trip in self.timetable.trips_on(service_day, pattern_id):
                    departure = trip.departure_at(index) + offset * SECONDS_PER_DAY
                    if departure < 0:
                        continue
                    entries.append((departure, trip, offset))
            entries.sort(key=lambda entry: (entry[0], entry[1].trip_id))
            found = tuple(entries)
            self._boardings[key] = found
        return found

    def _reconstruct(self, rounds: List[Dict[str, Label]], label: Label) -> Optional[Journey]:
        legs: List[Leg] = []
        current: Optional[Label] = label
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
        legs.reverse()
        if not legs:
            return None
        try:
            return Journey(tuple(legs))
        except PlanError:
            return None

    def _best(self, journeys: List[Journey]) -> tuple[Journey, ...]:
        kept: List[Journey] = []
        for journey in sorted(journeys, key=lambda item: item.sort_key()):
            if any(other.dominates(journey) for other in kept):
                continue
            if any(
                other.arrival == journey.arrival and other.transfers == journey.transfers
                for other in kept
            ):
                continue
            kept.append(journey)
        return tuple(kept[: self.options.max_journeys])
