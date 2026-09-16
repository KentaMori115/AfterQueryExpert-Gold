"""A network large enough to notice if something turns quadratic.

A grid city: twelve lines west to east, twelve north to south, a stop at every
crossing and a trip every ten minutes. That is around two and a half thousand
trips, which is a real small city and small enough that the whole suite still
runs in seconds. The timings here are loose on purpose: they are there to catch
an accident, not to measure a machine.
"""

import time
import unittest
from datetime import date

from layover.dates import DateRange
from layover.network import NetworkBuilder
from layover.plan import JourneySearch, SearchOptions
from layover.services import ServiceCalendar, ServiceRegistry
from layover.timetable import Timetable
from layover.times import TimeWindow, parse_clock

SIDE = 12
FIRST = parse_clock("06:00")
LAST = parse_clock("22:00")
HEADWAY = 600
PERIOD = DateRange(date(2026, 7, 1), date(2026, 7, 31))
DAY = date(2026, 7, 15)


def grid_network(side=SIDE):
    """A side by side grid of stops, with a line along every row and column."""
    builder = NetworkBuilder("grid")
    for row in range(side):
        for column in range(side):
            builder.stop(
                "s-%02d-%02d" % (row, column),
                "Stop %d %d" % (row, column),
                "52.%06d" % (500000 + row * 4000),
                "13.%06d" % (300000 + column * 6000),
                zone="A",
            )
    for row in range(side):
        stops = ["s-%02d-%02d" % (row, column) for column in range(side)]
        builder.route("row-%02d" % row, "R%d" % row, mode="tram")
        builder.pattern("row-%02d-east" % row, "row-%02d" % row, stops, "East")
    for column in range(side):
        stops = ["s-%02d-%02d" % (row, column) for row in range(side)]
        builder.route("col-%02d" % column, "C%d" % column, mode="bus")
        builder.pattern("col-%02d-south" % column, "col-%02d" % column, stops, "South")
    for index in range(side):
        for prefix, hop in (("row-%02d-east", 180), ("col-%02d-south", 240)):
            pattern_id = prefix % index
            start = FIRST + (index % 5) * 60
            number = 0
            while start <= LAST:
                times = [start + step * hop for step in range(side)]
                builder.trip("%s-%03d" % (pattern_id, number), pattern_id, "daily", times)
                number += 1
                start += HEADWAY
    return builder.build()


def grid_timetable(side=SIDE):
    """The grid read through a calendar that runs every day."""
    registry = ServiceRegistry([ServiceCalendar.weekly("daily", range(7), PERIOD)])
    return Timetable(grid_network(side), registry)


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.started = time.monotonic()
        self.network = grid_network()
        self.built_in = time.monotonic() - self.started

    def test_the_grid_has_a_stop_at_every_crossing(self):
        self.assertEqual(len(self.network), SIDE * SIDE)

    def test_the_grid_has_a_line_each_way(self):
        self.assertEqual(len(self.network.routes()), SIDE * 2)

    def test_the_grid_has_a_few_thousand_trips(self):
        self.assertGreater(len(self.network.trips()), 2000)

    def test_building_it_is_quick(self):
        self.assertLess(self.built_in, 10.0)

    def test_a_crossing_is_served_by_two_lines(self):
        self.assertEqual(len(self.network.routes_at("s-05-05")), 2)


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.timetable = grid_timetable()

    def test_the_whole_day_runs(self):
        self.assertEqual(self.timetable.trip_count(DAY), len(self.timetable.network.trips()))

    def test_a_board_comes_back_quickly(self):
        started = time.monotonic()
        for _ in range(20):
            self.timetable.departures("s-06-06", DAY, FIRST, limit=10)
        self.assertLess(time.monotonic() - started, 5.0)

    def test_a_board_holds_both_lines(self):
        routes = {
            entry.route_id for entry in self.timetable.departures("s-06-06", DAY, limit=None)
        }
        self.assertEqual(len(routes), 2)

    def test_the_first_departure_is_at_the_start_of_service(self):
        first = self.timetable.departures("s-00-00", DAY, limit=1)[0]
        self.assertLessEqual(first.departure, FIRST + 5 * 60)


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.timetable = grid_timetable()
        self.search = JourneySearch(self.timetable, SearchOptions(max_transfers=2))

    def test_a_journey_across_the_grid_needs_one_change(self):
        journeys = self.search.plan("s-00-00", "s-11-11", DAY, parse_clock("08:00"))
        self.assertTrue(journeys)
        self.assertLessEqual(journeys[0].transfers, 2)

    def test_a_journey_along_one_line_needs_none(self):
        journeys = self.search.plan("s-00-00", "s-00-11", DAY, parse_clock("08:00"))
        self.assertEqual(journeys[0].transfers, 0)

    def test_a_search_is_quick(self):
        started = time.monotonic()
        self.search.plan("s-00-00", "s-11-11", DAY, parse_clock("08:00"))
        self.assertLess(time.monotonic() - started, 5.0)

    def test_twenty_searches_are_quick(self):
        started = time.monotonic()
        for index in range(20):
            self.search.plan(
                "s-00-%02d" % (index % SIDE),
                "s-11-%02d" % ((index + 5) % SIDE),
                DAY,
                parse_clock("08:00") + index * 60,
            )
        self.assertLess(time.monotonic() - started, 20.0)

    def test_everywhere_is_reachable_from_a_corner(self):
        reachable = self.search.reachable("s-00-00", DAY, parse_clock("08:00"))
        self.assertEqual(len(reachable), SIDE * SIDE - 1)

    def test_reaching_everywhere_is_quick(self):
        started = time.monotonic()
        self.search.reachable("s-00-00", DAY, parse_clock("08:00"))
        self.assertLess(time.monotonic() - started, 5.0)

    def test_a_profile_over_an_hour(self):
        from layover.plan import plan_profile

        found = plan_profile(
            self.timetable,
            "s-00-00",
            "s-11-11",
            DAY,
            TimeWindow.parse("08:00-09:00"),
            SearchOptions(max_transfers=2),
            limit=4,
        )
        self.assertTrue(found)

    def test_the_answer_does_not_depend_on_the_order_asked(self):
        first = self.search.plan("s-02-03", "s-09-08", DAY, parse_clock("08:00"))
        self.search.plan("s-00-00", "s-11-11", DAY, parse_clock("07:00"))
        second = self.search.plan("s-02-03", "s-09-08", DAY, parse_clock("08:00"))
        self.assertEqual([str(journey) for journey in first], [str(journey) for journey in second])


if __name__ == "__main__":
    unittest.main()
