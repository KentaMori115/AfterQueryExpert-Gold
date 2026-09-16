"""The timetable read through a date."""

import unittest
from datetime import date

from layover.errors import PlanError
from layover.network import NetworkBuilder
from layover.services import ServiceCalendar, ServiceRegistry
from layover.timetable import Timetable
from layover.times import TimeWindow, parse_clock
from tests.support import JULY, MONDAY, SATURDAY, line_network, services


def timetable(**changes):
    return Timetable(line_network(), services(), **changes)


def midnight_timetable():
    builder = NetworkBuilder("late")
    builder.stop("a", "A", "52.5", "13.3")
    builder.stop("b", "B", "52.5", "13.4")
    builder.route("n", "N", mode="bus")
    builder.pattern("n-out", "n", ["a", "b"], "Night")
    builder.trip("n-late", "n-out", "daily", ["23:50", "24:20"])
    builder.trip("n-later", "n-out", "daily", ["24:50", "25:20"])
    builder.trip("n-early", "n-out", "daily", ["05:10", "05:40"])
    registry = ServiceRegistry([ServiceCalendar.weekly("daily", range(7), JULY)])
    return Timetable(builder.build(), registry)


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_a_weekday_runs_the_weekday_service(self):
        self.assertEqual(self.timetable.services_on(MONDAY), ("weekday",))

    def test_trips_on_a_weekday(self):
        self.assertEqual(len(self.timetable.trips_on(MONDAY, "x-east")), 4)

    def test_trips_on_a_saturday(self):
        self.assertEqual(len(self.timetable.trips_on(SATURDAY, "x-east")), 1)

    def test_trips_on_a_date_with_no_service(self):
        self.assertEqual(self.timetable.trips_on(date(2026, 6, 1), "x-east"), ())

    def test_the_answer_is_cached(self):
        first = self.timetable.trips_on(MONDAY, "x-east")
        self.assertIs(first, self.timetable.trips_on(MONDAY, "x-east"))

    def test_trips_are_sorted_by_departure(self):
        trips = self.timetable.trips_on(MONDAY, "x-east")
        self.assertEqual([t.start_time for t in trips], sorted(t.start_time for t in trips))

    def test_the_whole_day_is_counted(self):
        self.assertEqual(self.timetable.trip_count(MONDAY), 12)

    def test_a_saturday_is_quieter(self):
        self.assertEqual(self.timetable.trip_count(SATURDAY), 1)

    def test_running_trips_are_in_time_order(self):
        trips = self.timetable.running_trips(MONDAY)
        self.assertEqual([t.start_time for t in trips], sorted(t.start_time for t in trips))

    def test_routes_running_on_a_saturday(self):
        self.assertEqual(self.timetable.routes_running(SATURDAY), ("x",))

    def test_routes_running_on_a_weekday(self):
        self.assertEqual(self.timetable.routes_running(MONDAY), ("x", "y"))

    def test_a_negative_lookback_is_refused(self):
        with self.assertRaises(PlanError):
            timetable(days_back=-1)

    def test_renders_readably(self):
        self.assertIn("timetable over", str(self.timetable))


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_departures_are_in_time_order(self):
        found = self.timetable.departures("a", MONDAY)
        self.assertEqual([e.departure for e in found], sorted(e.departure for e in found))

    def test_departures_leave_out_the_last_stop_of_a_pattern(self):
        found = self.timetable.departures("d", MONDAY)
        self.assertEqual({entry.pattern.pattern_id for entry in found}, {"x-west"})

    def test_departures_can_be_limited(self):
        self.assertEqual(len(self.timetable.departures("a", MONDAY, limit=2)), 2)

    def test_departures_start_after_a_time(self):
        after = parse_clock("08:15")
        found = self.timetable.departures("a", MONDAY, after=after)
        self.assertTrue(all(entry.departure >= after for entry in found))

    def test_departures_can_be_filtered_by_route(self):
        found = self.timetable.departures("c", MONDAY, routes=["y"])
        self.assertTrue(all(entry.route_id == "y" for entry in found))

    def test_departures_can_be_filtered_by_mode(self):
        found = self.timetable.departures("c", MONDAY, modes=["bus"])
        self.assertTrue(all(entry.route_id == "y" for entry in found))

    def test_an_unknown_route_filter_finds_nothing(self):
        self.assertEqual(self.timetable.departures("c", MONDAY, routes=["z"]), ())

    def test_the_interchange_sees_both_routes(self):
        routes = {entry.route_id for entry in self.timetable.departures("c", MONDAY)}
        self.assertEqual(routes, {"x", "y"})

    def test_arrivals_are_in_time_order(self):
        found = self.timetable.arrivals("d", MONDAY)
        self.assertEqual([e.arrival for e in found], sorted(e.arrival for e in found))

    def test_arrivals_leave_out_the_first_stop(self):
        self.assertEqual(self.timetable.arrivals("a", MONDAY, limit=1)[0].route_id, "x")

    def test_the_next_departure_is_the_first_one_after(self):
        entry = self.timetable.next_departure("a", MONDAY, after=parse_clock("08:05"))
        self.assertEqual(entry.departure, parse_clock("08:10"))

    def test_there_is_no_departure_after_the_last(self):
        self.assertIsNone(self.timetable.next_departure("a", MONDAY, after=parse_clock("23:00")))

    def test_the_last_departure_of_the_day(self):
        self.assertEqual(self.timetable.last_departure("a", MONDAY).departure, parse_clock("08:30"))

    def test_no_last_departure_on_a_quiet_day(self):
        self.assertIsNone(self.timetable.last_departure("m", SATURDAY))

    def test_first_and_last_together(self):
        self.assertEqual(
            self.timetable.first_and_last("a", MONDAY),
            (parse_clock("08:00"), parse_clock("08:30")),
        )

    def test_first_and_last_of_a_stop_with_no_service(self):
        self.assertIsNone(self.timetable.first_and_last("m", SATURDAY))

    def test_the_headway_between_departures(self):
        window = TimeWindow.parse("08:00-09:00")
        self.assertEqual(self.timetable.headway("a", MONDAY, window), 600)

    def test_no_headway_from_a_single_departure(self):
        window = TimeWindow.parse("08:00-08:05")
        self.assertIsNone(self.timetable.headway("a", MONDAY, window))

    def test_a_served_stop(self):
        self.assertTrue(self.timetable.serves("a", MONDAY))

    def test_an_unserved_date(self):
        self.assertFalse(self.timetable.serves("m", SATURDAY))

    def test_the_busiest_stop_is_the_interchange(self):
        self.assertEqual(self.timetable.busiest_stop(MONDAY), "c")

    def test_no_busiest_stop_on_a_dead_day(self):
        self.assertIsNone(self.timetable.busiest_stop(date(2026, 6, 1)))

    def test_calls_can_be_windowed(self):
        window = TimeWindow.parse("08:00-08:11")
        found = self.timetable.calls_at("a", MONDAY, window)
        self.assertTrue(all(window.contains(entry.departure) for entry in found))

    def test_calls_at_an_unknown_stop_raise(self):
        with self.assertRaises(Exception):
            self.timetable.calls_at("z", MONDAY)


class MidnightTest(unittest.TestCase):
    def setUp(self):
        self.timetable = midnight_timetable()
        self.tuesday = date(2026, 7, 7)

    def test_a_trip_past_midnight_appears_the_next_morning(self):
        found = self.timetable.departures("a", self.tuesday, limit=1)
        self.assertEqual(found[0].trip_id, "n-later")

    def test_it_is_timed_on_the_new_day(self):
        found = self.timetable.departures("a", self.tuesday, limit=1)
        self.assertEqual(found[0].departure, parse_clock("00:50"))

    def test_it_knows_it_came_from_yesterday(self):
        found = self.timetable.departures("a", self.tuesday, limit=1)
        self.assertTrue(found[0].from_yesterday)

    def test_it_keeps_its_own_service_date(self):
        found = self.timetable.departures("a", self.tuesday, limit=1)
        self.assertEqual(found[0].service_date, MONDAY)

    def test_the_late_evening_trip_stays_on_its_own_day(self):
        found = self.timetable.departures("a", MONDAY)
        self.assertIn("n-late", [entry.trip_id for entry in found])

    def test_the_whole_of_the_next_day_is_listed_in_order(self):
        found = [entry.trip_id for entry in self.timetable.departures("a", self.tuesday)]
        self.assertEqual(found, ["n-later", "n-early", "n-late", "n-later"])

    def test_the_late_run_appears_once_from_each_service_day(self):
        found = self.timetable.departures("a", self.tuesday)
        late = [entry for entry in found if entry.trip_id == "n-later"]
        self.assertEqual([entry.day_offset for entry in late], [-1, 0])

    def test_yesterday_can_be_switched_off(self):
        plain = Timetable(self.timetable.network, self.timetable.services, days_back=0)
        found = [entry.trip_id for entry in plain.departures("a", self.tuesday)]
        self.assertEqual(found, ["n-early", "n-late", "n-later"])

    def test_an_arrival_after_midnight_is_on_the_new_day(self):
        found = self.timetable.arrivals("b", self.tuesday, limit=1)
        self.assertEqual(found[0].arrival, parse_clock("00:20"))


if __name__ == "__main__":
    unittest.main()
