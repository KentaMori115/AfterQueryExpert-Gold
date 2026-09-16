"""How often something runs, over a window and over a day."""

import unittest

from layover.errors import PlanError
from layover.timetable import (
    Frequency,
    Timetable,
    busiest_window,
    route_frequency,
    service_profile,
    stop_frequency,
)
from layover.times import SECONDS_PER_HOUR, TimeWindow, parse_clock
from tests.support import MONDAY, SATURDAY, line_network, services

MORNING = TimeWindow.parse("08:00-09:00")


def timetable():
    return Timetable(line_network(), services())


class FrequencyTest(unittest.TestCase):
    def setUp(self):
        self.frequency = Frequency("a", MORNING, (28800, 29400, 30000, 30900))

    def test_it_counts_the_departures(self):
        self.assertEqual(self.frequency.count, 4)

    def test_the_times_come_back_sorted(self):
        jumbled = Frequency("a", MORNING, (30000, 28800))
        self.assertEqual(jumbled.times, (28800, 30000))

    def test_the_first_and_last(self):
        self.assertEqual((self.frequency.first, self.frequency.last), (28800, 30900))

    def test_the_gaps_between_them(self):
        self.assertEqual(self.frequency.gaps(), (600, 600, 900))

    def test_the_mean_headway(self):
        self.assertEqual(self.frequency.mean_headway, 700)

    def test_the_longest_and_shortest_gap(self):
        self.assertEqual((self.frequency.shortest_gap, self.frequency.longest_gap), (600, 900))

    def test_departures_an_hour(self):
        self.assertEqual(self.frequency.per_hour, 4)

    def test_an_uneven_service_is_not_even(self):
        self.assertFalse(self.frequency.is_even(tolerance=60))

    def test_an_even_service_is(self):
        even = Frequency("a", MORNING, (0, 600, 1200, 1800))
        self.assertTrue(even.is_even())

    def test_two_departures_are_not_enough_to_call_it_even(self):
        self.assertFalse(Frequency("a", MORNING, (0, 600)).is_even())

    def test_nothing_has_no_headway(self):
        empty = Frequency("a", MORNING, ())
        self.assertIsNone(empty.mean_headway)
        self.assertIsNone(empty.first)
        self.assertIsNone(empty.longest_gap)

    def test_nothing_describes_itself(self):
        self.assertIn("nothing between", Frequency("a", MORNING, ()).describe())

    def test_one_departure_describes_itself(self):
        self.assertEqual(
            Frequency("a", MORNING, (28800,)).describe(), "one departure, at 08:00"
        )

    def test_a_full_window_describes_itself(self):
        self.assertIn("4 departures", self.frequency.describe())

    def test_it_renders_with_its_subject(self):
        self.assertTrue(str(self.frequency).startswith("a: "))

    def test_it_is_hashable(self):
        self.assertEqual(len({self.frequency, self.frequency}), 1)


class StopFrequencyTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_it_counts_what_leaves(self):
        found = stop_frequency(self.timetable, "a", MONDAY, MORNING)
        self.assertEqual(found.count, 4)

    def test_the_subject_is_the_stop(self):
        self.assertEqual(stop_frequency(self.timetable, "a", MONDAY, MORNING).subject, "a")

    def test_it_leaves_out_what_is_outside_the_window(self):
        narrow = TimeWindow.parse("08:00-08:15")
        self.assertEqual(stop_frequency(self.timetable, "a", MONDAY, narrow).count, 2)

    def test_it_can_be_filtered_by_route(self):
        found = stop_frequency(self.timetable, "c", MONDAY, MORNING, routes=["y"])
        self.assertEqual(found.count, 4)

    def test_a_quiet_day_is_quiet(self):
        self.assertEqual(stop_frequency(self.timetable, "m", SATURDAY, MORNING).count, 0)

    def test_the_headway_of_a_regular_service(self):
        found = stop_frequency(self.timetable, "a", MONDAY, MORNING)
        self.assertEqual(found.mean_headway, 600)

    def test_a_regular_service_is_even(self):
        self.assertTrue(stop_frequency(self.timetable, "a", MONDAY, MORNING).is_even())


class RouteFrequencyTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_it_counts_both_directions(self):
        found = route_frequency(self.timetable, "x", MONDAY, MORNING)
        self.assertEqual(found.count, 8)

    def test_one_direction_can_be_asked_for(self):
        found = route_frequency(self.timetable, "x", MONDAY, MORNING, direction=0)
        self.assertEqual(found.count, 4)

    def test_the_other_direction_too(self):
        found = route_frequency(self.timetable, "x", MONDAY, MORNING, direction=1)
        self.assertEqual(found.count, 4)

    def test_the_subject_is_the_route(self):
        self.assertEqual(route_frequency(self.timetable, "x", MONDAY, MORNING).subject, "x")

    def test_a_route_that_does_not_run_counts_nothing(self):
        self.assertEqual(route_frequency(self.timetable, "y", SATURDAY, MORNING).count, 0)


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_a_day_breaks_into_twenty_four_hours(self):
        self.assertEqual(len(service_profile(self.timetable, "a", MONDAY)), 24)

    def test_the_busy_hour_holds_the_departures(self):
        found = service_profile(self.timetable, "a", MONDAY)
        self.assertEqual(found[8].count, 4)

    def test_the_quiet_hours_hold_nothing(self):
        found = service_profile(self.timetable, "a", MONDAY)
        self.assertEqual(sum(slice_.count for slice_ in found[:8]), 0)

    def test_a_smaller_step_makes_more_slices(self):
        found = service_profile(self.timetable, "a", MONDAY, MORNING, step=1800)
        self.assertEqual(len(found), 2)

    def test_a_step_of_nothing_is_refused(self):
        with self.assertRaises(PlanError):
            service_profile(self.timetable, "a", MONDAY, step=0)

    def test_the_slices_join_up(self):
        found = service_profile(self.timetable, "a", MONDAY, MORNING, step=1800)
        self.assertEqual(found[0].window.end, found[1].window.start)

    def test_the_busiest_hour_is_found(self):
        found = busiest_window(self.timetable, "a", MONDAY)
        self.assertEqual(found.window.start, parse_clock("08:00"))

    def test_the_busiest_hour_of_a_dead_stop_is_nothing(self):
        self.assertIsNone(busiest_window(self.timetable, "m", SATURDAY))

    def test_the_busiest_hour_counts_what_it_holds(self):
        self.assertEqual(busiest_window(self.timetable, "a", MONDAY).count, 4)

    def test_a_finer_step_still_finds_the_peak(self):
        found = busiest_window(self.timetable, "a", MONDAY, step=SECONDS_PER_HOUR // 2)
        self.assertGreater(found.count, 0)


if __name__ == "__main__":
    unittest.main()
