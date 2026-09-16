"""The search, answered again the slow obvious way, and compared.

A round based search is not obviously right. So here the same questions are
answered by walking every trip in the timetable and trying every combination,
which is far too slow for a real network and exactly right for a small one. If
the two disagree, the fast one is wrong.
"""

import unittest
from datetime import date
from itertools import product

from layover.plan import JourneySearch, SearchOptions
from layover.timetable import Timetable
from layover.times import parse_clock
from tests.support import MONDAY, line_network, services, transfer_network

MORNING = parse_clock("07:00")


def boardings(timetable, day):
    """Every call of every running trip, as (stop, index, trip) triples."""
    found = []
    for trip in timetable.running_trips(day):
        pattern = timetable.network.pattern(trip.pattern_id)
        for index, stop_id in enumerate(pattern.stops):
            found.append((stop_id, index, trip, pattern))
    return found


def brute_force(timetable, day, origin, destination, after, rides=2, buffer_seconds=0):
    """The earliest arrival, found by trying every combination there is.

    This walks the tree of possibilities: board any trip that is still there,
    get off anywhere it calls, walk one declared transfer if there is one, and
    do it again up to ``rides`` times. No labels, no pruning, nothing clever.
    """
    network = timetable.network
    calls = boardings(timetable, day)
    best = [None]

    def record(arrival):
        if best[0] is None or arrival < best[0]:
            best[0] = arrival

    def visit(stop, time, ridden, by_ride):
        if stop == destination:
            record(time)
        for transfer in network.transfers_from(stop):
            if transfer.to_stop == destination:
                record(time + transfer.seconds)
        if ridden >= rides:
            return
        ready = [(stop, time + (buffer_seconds if by_ride else 0))]
        ready.extend(
            (transfer.to_stop, time + transfer.seconds)
            for transfer in network.transfers_from(stop)
        )
        for at_stop, moment in ready:
            for stop_id, index, trip, pattern in calls:
                if stop_id != at_stop or not pattern.can_board(index):
                    continue
                if trip.departure_at(index) < moment:
                    continue
                for later in range(index + 1, len(pattern)):
                    if not pattern.can_alight(later):
                        continue
                    visit(pattern.stops[later], trip.arrival_at(later), ridden + 1, True)

    visit(origin, after, 0, False)
    return best[0]


def one_ride(timetable, day, origin, destination, after):
    """The earliest arrival using one vehicle and no walking."""
    best = None
    for stop_id, index, trip, pattern in boardings(timetable, day):
        if stop_id != origin or not pattern.can_board(index):
            continue
        if trip.departure_at(index) < after:
            continue
        for later in range(index + 1, len(pattern)):
            if pattern.stops[later] != destination or not pattern.can_alight(later):
                continue
            arrival = trip.arrival_at(later)
            if best is None or arrival < best:
                best = arrival
    return best


class DirectTest(unittest.TestCase):
    def setUp(self):
        self.timetable = Timetable(line_network(), services())
        self.search = JourneySearch(self.timetable, SearchOptions(max_transfers=0))

    def test_agrees_on_a_direct_journey(self):
        for origin, destination in (("a", "b"), ("a", "d"), ("b", "d"), ("m", "p")):
            with self.subTest(origin=origin, destination=destination):
                self.assertEqual(
                    self.search.earliest_arrival(origin, destination, MONDAY, MORNING),
                    one_ride(self.timetable, MONDAY, origin, destination, MORNING),
                )

    def test_agrees_that_there_is_nothing_backwards(self):
        self.assertEqual(
            self.search.earliest_arrival("d", "a", MONDAY, parse_clock("09:00")),
            one_ride(self.timetable, MONDAY, "d", "a", parse_clock("09:00")),
        )

    def test_agrees_at_every_departure_time(self):
        for minute in range(0, 60, 7):
            after = parse_clock("08:00") + minute * 60
            with self.subTest(after=after):
                self.assertEqual(
                    self.search.earliest_arrival("a", "d", MONDAY, after),
                    one_ride(self.timetable, MONDAY, "a", "d", after),
                )


class ChangeTest(unittest.TestCase):
    def setUp(self):
        self.timetable = Timetable(line_network(), services())
        self.search = JourneySearch(self.timetable, SearchOptions(max_transfers=1))

    def test_agrees_on_a_journey_with_one_change(self):
        for origin, destination in (("a", "p"), ("m", "d"), ("b", "p"), ("n", "b")):
            with self.subTest(origin=origin, destination=destination):
                self.assertEqual(
                    self.search.earliest_arrival(origin, destination, MONDAY, MORNING),
                    brute_force(self.timetable, MONDAY, origin, destination, MORNING),
                )

    def test_agrees_across_a_spread_of_start_times(self):
        for minute in range(0, 50, 11):
            after = parse_clock("08:00") + minute * 60
            with self.subTest(after=after):
                self.assertEqual(
                    self.search.earliest_arrival("a", "p", MONDAY, after),
                    brute_force(self.timetable, MONDAY, "a", "p", after),
                )

    def test_agrees_when_a_buffer_is_required(self):
        search = JourneySearch(
            self.timetable, SearchOptions(max_transfers=1, min_transfer_seconds=120)
        )
        self.assertEqual(
            search.earliest_arrival("a", "p", MONDAY, MORNING),
            brute_force(self.timetable, MONDAY, "a", "p", MORNING, buffer_seconds=120),
        )

    def test_agrees_that_nothing_runs_late_at_night(self):
        after = parse_clock("22:00")
        self.assertEqual(
            self.search.earliest_arrival("a", "p", MONDAY, after),
            brute_force(self.timetable, MONDAY, "a", "p", after),
        )


class WalkTest(unittest.TestCase):
    def setUp(self):
        self.timetable = Timetable(transfer_network(), services())
        self.search = JourneySearch(self.timetable, SearchOptions(max_transfers=1))

    def test_agrees_when_a_walk_is_needed(self):
        self.assertEqual(
            self.search.earliest_arrival("p", "s", MONDAY, MORNING),
            brute_force(self.timetable, MONDAY, "p", "s", MORNING),
        )

    def test_agrees_on_every_pair_of_stops(self):
        stops = ("p", "q", "r", "s", "x", "y")
        for origin, destination in product(stops, stops):
            if origin == destination:
                continue
            with self.subTest(origin=origin, destination=destination):
                self.assertEqual(
                    self.search.earliest_arrival(origin, destination, MONDAY, MORNING),
                    brute_force(self.timetable, MONDAY, origin, destination, MORNING),
                )

    def test_agrees_across_a_spread_of_start_times(self):
        for minute in range(0, 90, 13):
            after = parse_clock("07:30") + minute * 60
            with self.subTest(after=after):
                self.assertEqual(
                    self.search.earliest_arrival("p", "s", MONDAY, after),
                    brute_force(self.timetable, MONDAY, "p", "s", after),
                )


class ReachabilityTest(unittest.TestCase):
    def setUp(self):
        self.timetable = Timetable(line_network(), services())
        self.search = JourneySearch(self.timetable, SearchOptions(max_transfers=1))

    def test_the_reachable_set_agrees_with_the_slow_answer(self):
        reachable = self.search.reachable("a", MONDAY, MORNING)
        for stop in self.timetable.network.stop_ids():
            if stop == "a":
                continue
            slow = brute_force(self.timetable, MONDAY, "a", stop, MORNING)
            with self.subTest(stop=stop):
                self.assertEqual(reachable.get(stop), slow)

    def test_the_same_holds_from_the_interchange(self):
        reachable = self.search.reachable("c", MONDAY, MORNING)
        for stop in self.timetable.network.stop_ids():
            if stop == "c":
                continue
            slow = brute_force(self.timetable, MONDAY, "c", stop, MORNING)
            with self.subTest(stop=stop):
                self.assertEqual(reachable.get(stop), slow)


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.timetable = Timetable(line_network(), services())

    def test_a_board_holds_every_boardable_call(self):
        for stop in self.timetable.network.stop_ids():
            expected = sorted(
                trip.departure_at(index)
                for stop_id, index, trip, pattern in boardings(self.timetable, MONDAY)
                if stop_id == stop and pattern.can_board(index)
            )
            found = [
                entry.departure
                for entry in self.timetable.departures(stop, MONDAY, limit=None)
            ]
            with self.subTest(stop=stop):
                self.assertEqual(found, expected)

    def test_an_arrival_board_holds_every_alightable_call(self):
        for stop in self.timetable.network.stop_ids():
            expected = sorted(
                trip.arrival_at(index)
                for stop_id, index, trip, pattern in boardings(self.timetable, MONDAY)
                if stop_id == stop and pattern.can_alight(index)
            )
            found = [
                entry.arrival for entry in self.timetable.arrivals(stop, MONDAY, limit=None)
            ]
            with self.subTest(stop=stop):
                self.assertEqual(found, expected)


if __name__ == "__main__":
    unittest.main()
