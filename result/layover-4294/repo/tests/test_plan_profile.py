"""Range queries over a window of departures."""

import unittest

from layover.errors import PlanError
from layover.plan import SearchOptions, plan_journeys, plan_profile
from layover.timetable import Timetable
from layover.times import TimeWindow, parse_clock
from tests.support import MONDAY, SATURDAY, line_network, services, transfer_network


def timetable(network=None):
    return Timetable(network or line_network(), services())


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()
        self.morning = TimeWindow.parse("07:30-09:30")

    def profile(self, **settings):
        return plan_profile(self.timetable, "a", "p", MONDAY, self.morning, **settings)

    def test_finds_several_journeys(self):
        self.assertGreater(len(self.profile()), 1)

    def test_they_leave_at_different_times(self):
        departures = [journey.departure for journey in self.profile()]
        self.assertEqual(len(departures), len(set(departures)))

    def test_they_come_back_in_departure_order(self):
        departures = [journey.departure for journey in self.profile()]
        self.assertEqual(departures, sorted(departures))

    def test_they_all_leave_inside_the_window(self):
        for journey in self.profile():
            with self.subTest(journey=journey):
                self.assertTrue(self.morning.contains(journey.departure))

    def test_the_first_matches_a_plain_search(self):
        direct = plan_journeys(self.timetable, "a", "p", MONDAY, self.morning.start)
        self.assertEqual(self.profile()[0].departure, direct[0].departure)

    def test_a_limit_is_respected(self):
        self.assertEqual(len(self.profile(limit=2)), 2)

    def test_a_limit_below_one_is_refused(self):
        with self.assertRaises(PlanError):
            self.profile(limit=0)

    def test_a_narrow_window_finds_one_journey(self):
        window = TimeWindow.parse("07:55-08:05")
        found = plan_profile(self.timetable, "a", "p", MONDAY, window)
        self.assertEqual(len(found), 1)

    def test_an_empty_window_finds_nothing(self):
        window = TimeWindow.parse("22:00-23:00")
        self.assertEqual(plan_profile(self.timetable, "a", "p", MONDAY, window), ())

    def test_a_day_with_no_service_finds_nothing(self):
        window = TimeWindow.parse("07:30-09:30")
        self.assertEqual(plan_profile(self.timetable, "m", "p", SATURDAY, window), ())

    def test_settings_are_passed_through(self):
        options = SearchOptions(max_transfers=0)
        window = TimeWindow.parse("07:30-09:30")
        self.assertEqual(plan_profile(self.timetable, "a", "p", MONDAY, window, options), ())

    def test_the_window_widens_a_short_search(self):
        options = SearchOptions(search_window=60)
        found = plan_profile(self.timetable, "a", "p", MONDAY, self.morning, options)
        self.assertTrue(found)

    def test_a_profile_over_the_transfer_network(self):
        found = plan_profile(
            timetable(transfer_network()), "p", "s", MONDAY, TimeWindow.parse("07:30-10:00")
        )
        self.assertGreater(len(found), 2)

    def test_both_options_appear_at_one_departure_time(self):
        found = plan_profile(
            timetable(transfer_network()), "p", "s", MONDAY, TimeWindow.parse("07:55-08:05")
        )
        self.assertEqual({journey.routes() for journey in found}, {("in", "out"), ("slow",)})

    def test_the_convenience_search_agrees_with_the_class(self):
        found = plan_journeys(self.timetable, "a", "p", MONDAY, parse_clock("07:30"))
        self.assertEqual(found[0].arrival, parse_clock("08:14"))


if __name__ == "__main__":
    unittest.main()
