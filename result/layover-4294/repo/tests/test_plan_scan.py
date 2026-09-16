"""The round based journey search."""

import unittest
from datetime import date

from layover.errors import NetworkError, PlanError
from layover.network import NetworkBuilder
from layover.plan import JourneySearch, SearchOptions
from layover.services import ServiceCalendar, ServiceRegistry
from layover.timetable import Timetable
from layover.times import parse_clock
from tests.support import JULY, MONDAY, SATURDAY, line_network, services, transfer_network

MORNING = parse_clock("07:30")


def search(network=None, **settings):
    timetable = Timetable(network or line_network(), services())
    return JourneySearch(timetable, SearchOptions(**settings) if settings else None)


class DirectTest(unittest.TestCase):
    def setUp(self):
        self.search = search()

    def test_finds_a_direct_journey(self):
        journeys = self.search.plan("a", "d", MONDAY, MORNING)
        self.assertEqual(journeys[0].routes(), ("x",))

    def test_the_direct_journey_leaves_when_the_first_trip_does(self):
        journeys = self.search.plan("a", "d", MONDAY, MORNING)
        self.assertEqual(journeys[0].departure, parse_clock("08:00"))

    def test_it_arrives_when_the_trip_does(self):
        journeys = self.search.plan("a", "d", MONDAY, MORNING)
        self.assertEqual(journeys[0].arrival, parse_clock("08:15"))

    def test_the_intermediate_stops_are_kept(self):
        journeys = self.search.plan("a", "d", MONDAY, MORNING)
        self.assertEqual(journeys[0].legs[0].intermediate, ("b", "c"))

    def test_a_later_start_catches_a_later_trip(self):
        journeys = self.search.plan("a", "d", MONDAY, parse_clock("08:05"))
        self.assertEqual(journeys[0].departure, parse_clock("08:10"))

    def test_nothing_runs_after_the_last_trip(self):
        self.assertEqual(self.search.plan("a", "d", MONDAY, parse_clock("22:00")), ())

    def test_nothing_runs_on_a_day_with_no_service(self):
        self.assertEqual(self.search.plan("a", "d", date(2026, 6, 1), MORNING), ())

    def test_the_weekend_service_is_used_on_a_saturday(self):
        journeys = self.search.plan("a", "d", SATURDAY, MORNING)
        self.assertEqual(journeys[0].departure, parse_clock("09:00"))

    def test_the_earliest_arrival_is_reported(self):
        self.assertEqual(self.search.earliest_arrival("a", "d", MONDAY, MORNING), parse_clock("08:15"))

    def test_no_arrival_when_nothing_runs(self):
        self.assertIsNone(self.search.earliest_arrival("a", "d", MONDAY, parse_clock("22:00")))

    def test_a_journey_to_itself_is_refused(self):
        with self.assertRaises(PlanError):
            self.search.plan("a", "a", MONDAY, MORNING)

    def test_an_unknown_origin_is_refused(self):
        with self.assertRaises(NetworkError):
            self.search.plan("z", "d", MONDAY, MORNING)

    def test_an_unknown_destination_is_refused(self):
        with self.assertRaises(NetworkError):
            self.search.plan("a", "z", MONDAY, MORNING)

    def test_a_start_before_the_day_is_refused(self):
        with self.assertRaises(PlanError):
            self.search.plan("a", "d", MONDAY, -1)

    def test_boarding_at_the_last_stop_is_impossible(self):
        self.assertEqual(self.search.plan("d", "a", MONDAY, parse_clock("08:50")), ())


class ChangeTest(unittest.TestCase):
    def setUp(self):
        self.search = search()

    def test_finds_a_journey_with_one_change(self):
        journeys = self.search.plan("a", "p", MONDAY, MORNING)
        self.assertEqual(journeys[0].transfers, 1)

    def test_the_change_is_at_the_interchange(self):
        journeys = self.search.plan("a", "p", MONDAY, MORNING)
        self.assertEqual(journeys[0].interchanges(), ("c",))

    def test_the_routes_are_used_in_order(self):
        journeys = self.search.plan("a", "p", MONDAY, MORNING)
        self.assertEqual(journeys[0].routes(), ("x", "y"))

    def test_no_journey_when_changes_are_forbidden(self):
        direct = search(max_transfers=0)
        self.assertEqual(direct.plan("a", "p", MONDAY, MORNING), ())

    def test_a_direct_journey_still_works_with_no_changes(self):
        direct = search(max_transfers=0)
        self.assertEqual(len(direct.plan("a", "d", MONDAY, MORNING)), 1)

    def test_a_buffer_can_make_a_change_impossible(self):
        tight = search(min_transfer_seconds=600)
        journeys = tight.plan("a", "p", MONDAY, MORNING)
        self.assertTrue(all(journey.arrival > parse_clock("08:14") for journey in journeys))

    def test_a_small_buffer_keeps_the_change(self):
        loose = search(min_transfer_seconds=60)
        self.assertTrue(loose.plan("a", "p", MONDAY, MORNING))

    def test_journeys_are_sorted_by_arrival(self):
        journeys = self.search.plan("a", "p", MONDAY, MORNING)
        self.assertEqual(
            [journey.arrival for journey in journeys],
            sorted(journey.arrival for journey in journeys),
        )

    def test_the_number_of_journeys_can_be_limited(self):
        limited = search(max_journeys=1, network=transfer_network())
        self.assertEqual(len(limited.plan("p", "s", MONDAY, MORNING)), 1)


class WalkTest(unittest.TestCase):
    def setUp(self):
        self.search = search(network=transfer_network())

    def test_a_walk_between_stops_is_used(self):
        journeys = self.search.plan("p", "s", MONDAY, MORNING)
        self.assertTrue(any(journey.walks for journey in journeys))

    def test_the_walk_takes_the_declared_time(self):
        journeys = self.search.plan("p", "s", MONDAY, MORNING)
        walk = journeys[0].walks[0]
        self.assertEqual(walk.duration, 120)

    def test_the_quick_way_arrives_first(self):
        journeys = self.search.plan("p", "s", MONDAY, MORNING)
        self.assertEqual(journeys[0].arrival, parse_clock("08:18"))

    def test_the_slow_direct_journey_is_offered_too(self):
        journeys = self.search.plan("p", "s", MONDAY, MORNING)
        self.assertIn(("slow",), [journey.routes() for journey in journeys])

    def test_neither_journey_dominates_the_other(self):
        journeys = self.search.plan("p", "s", MONDAY, MORNING)
        self.assertEqual(len(journeys), 2)

    def test_a_walk_limit_rules_the_quick_way_out(self):
        strict = search(network=transfer_network(), max_walk_seconds=60)
        routes = [journey.routes() for journey in strict.plan("p", "s", MONDAY, MORNING)]
        self.assertEqual(routes, [("slow",)])

    def test_a_walk_exactly_on_the_limit_is_allowed(self):
        exact = search(network=transfer_network(), max_walk_seconds=120)
        self.assertTrue(any(journey.walks for journey in exact.plan("p", "s", MONDAY, MORNING)))


class FilterTest(unittest.TestCase):
    def test_a_banned_route_is_not_used(self):
        banned = search(network=transfer_network(), banned_routes=frozenset(["in"]))
        routes = [journey.routes() for journey in banned.plan("p", "s", MONDAY, MORNING)]
        self.assertEqual(routes, [("slow",)])

    def test_banning_everything_finds_nothing(self):
        banned = search(banned_routes=frozenset(["x", "y"]))
        self.assertEqual(banned.plan("a", "p", MONDAY, MORNING), ())

    def test_a_mode_filter_keeps_the_metro(self):
        metro = search(network=transfer_network(), allowed_modes=frozenset(["metro"]))
        routes = [journey.routes() for journey in metro.plan("p", "s", MONDAY, MORNING)]
        self.assertEqual(routes, [("in", "out")])

    def test_a_mode_filter_can_leave_nothing(self):
        ferry = search(allowed_modes=frozenset(["ferry"]))
        self.assertEqual(ferry.plan("a", "p", MONDAY, MORNING), ())

    def test_the_search_window_cuts_off_late_trips(self):
        narrow = search(search_window=600)
        self.assertEqual(narrow.plan("a", "d", MONDAY, parse_clock("06:00")), ())

    def test_a_wide_window_finds_them(self):
        wide = search(search_window=4 * 3600)
        self.assertTrue(wide.plan("a", "d", MONDAY, parse_clock("06:00")))


class ReachableTest(unittest.TestCase):
    def setUp(self):
        self.search = search()

    def test_reaches_the_other_stops(self):
        found = self.search.reachable("a", MONDAY, MORNING)
        self.assertEqual(set(found), {"b", "c", "d", "p"})

    def test_the_origin_is_left_out(self):
        self.assertNotIn("a", self.search.reachable("a", MONDAY, MORNING))

    def test_the_arrival_times_are_the_earliest(self):
        found = self.search.reachable("a", MONDAY, MORNING)
        self.assertEqual(found["b"], parse_clock("08:05"))

    def test_nothing_is_reachable_after_the_last_trip(self):
        self.assertEqual(self.search.reachable("a", MONDAY, parse_clock("22:00")), {})

    def test_a_stop_upstream_is_not_reachable(self):
        found = self.search.reachable("c", MONDAY, MORNING)
        self.assertIn("d", found)


class MidnightTest(unittest.TestCase):
    def setUp(self):
        builder = NetworkBuilder("late")
        builder.stop("a", "A", "52.5", "13.3")
        builder.stop("b", "B", "52.5", "13.4")
        builder.route("n", "N", mode="bus")
        builder.pattern("n-out", "n", ["a", "b"], "Night")
        builder.trip("n-late", "n-out", "daily", ["24:40", "25:10"])
        builder.trip("n-day", "n-out", "daily", ["12:00", "12:30"])
        registry = ServiceRegistry([ServiceCalendar.weekly("daily", range(7), JULY)])
        self.search = JourneySearch(Timetable(builder.build(), registry))
        self.tuesday = date(2026, 7, 7)

    def test_a_trip_from_yesterday_can_be_caught(self):
        journeys = self.search.plan("a", "b", self.tuesday, parse_clock("00:00"))
        self.assertEqual(journeys[0].departure, parse_clock("00:40"))

    def test_it_arrives_on_the_new_day(self):
        journeys = self.search.plan("a", "b", self.tuesday, parse_clock("00:00"))
        self.assertEqual(journeys[0].arrival, parse_clock("01:10"))

    def test_the_same_trip_serves_its_own_day_late_on(self):
        journeys = self.search.plan("a", "b", MONDAY, parse_clock("23:00"))
        self.assertEqual(journeys[0].departure, parse_clock("24:40"))


if __name__ == "__main__":
    unittest.main()
