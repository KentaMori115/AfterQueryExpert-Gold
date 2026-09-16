"""Reports about how often things run."""

import unittest

from layover.report.frequency import frequency_report, profile_report, route_frequency_report
from layover.timetable import Timetable
from layover.times import TimeWindow
from tests.support import MONDAY, SATURDAY, line_network, services

MORNING = TimeWindow.parse("08:00-09:00")


def timetable():
    return Timetable(line_network(), services())


class StopFrequencyReportTest(unittest.TestCase):
    def setUp(self):
        self.report = frequency_report(timetable(), MONDAY, MORNING)

    def test_a_row_per_stop(self):
        self.assertEqual(len(self.report), 7)

    def test_the_columns_are_named(self):
        self.assertEqual(self.report.headers[0], "Stop")

    def test_the_departure_count_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "a"][0]
        self.assertEqual(row[2], "4")

    def test_the_headway_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "a"][0]
        self.assertEqual(row[4], "10m")

    def test_an_even_service_says_so(self):
        row = [row for row in self.report.rows if row[0] == "a"][0]
        self.assertEqual(row[6], "yes")

    def test_the_window_is_in_the_title(self):
        self.assertIn("08:00-09:00", self.report.title)

    def test_only_some_stops_can_be_asked_for(self):
        report = frequency_report(timetable(), MONDAY, MORNING, stops=["a", "c"])
        self.assertEqual(len(report), 2)

    def test_a_quiet_stop_shows_nothing(self):
        report = frequency_report(timetable(), SATURDAY, MORNING)
        row = [row for row in report.rows if row[0] == "m"][0]
        self.assertEqual(row[2], "0")


class RouteFrequencyReportTest(unittest.TestCase):
    def setUp(self):
        self.report = route_frequency_report(timetable(), MONDAY, MORNING)

    def test_a_row_per_route_and_direction(self):
        self.assertEqual(len(self.report), 3)

    def test_the_directions_are_named(self):
        self.assertEqual({row[1] for row in self.report.rows}, {"out", "back"})

    def test_the_count_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "Y"][0]
        self.assertEqual(row[2], "4")

    def test_a_dead_window_says_so(self):
        report = route_frequency_report(timetable(), MONDAY, TimeWindow.parse("22:00-23:00"))
        self.assertIn("Nothing runs inside this window.", report.notes)


class ProfileReportTest(unittest.TestCase):
    def setUp(self):
        self.report = profile_report(timetable(), "a", MONDAY)

    def test_a_row_per_hour(self):
        self.assertEqual(len(self.report), 24)

    def test_the_busy_hour_is_marked(self):
        row = [row for row in self.report.rows if row[0] == "08:00"][0]
        self.assertEqual(row[1], "4")

    def test_the_bar_is_as_long_as_the_count(self):
        row = [row for row in self.report.rows if row[0] == "08:00"][0]
        self.assertEqual(row[2], "####")

    def test_a_quiet_hour_has_no_bar(self):
        row = [row for row in self.report.rows if row[0] == "03:00"][0]
        self.assertEqual(row[2], "")

    def test_a_finer_step_makes_more_rows(self):
        self.assertEqual(len(profile_report(timetable(), "a", MONDAY, step=1800)), 48)

    def test_the_stop_name_is_in_the_title(self):
        self.assertIn("Stop A", self.report.title)


if __name__ == "__main__":
    unittest.main()
