"""Printed timetable reports."""

import unittest

from layover.report.timetable import pattern_report, route_report
from layover.timetable import Timetable
from layover.times import TimeWindow
from tests.support import MONDAY, SATURDAY, line_network, services


def timetable():
    return Timetable(line_network(), services())


class PatternReportTest(unittest.TestCase):
    def setUp(self):
        self.report = pattern_report(timetable(), "x-east", MONDAY)

    def test_the_title_names_the_route_and_date(self):
        self.assertEqual(self.report.title, "tram X, 2026-07-06")

    def test_a_row_per_stop(self):
        self.assertEqual(len(self.report), 4)

    def test_a_column_per_trip_plus_the_stop(self):
        self.assertEqual(len(self.report.headers), 5)

    def test_the_first_column_is_the_stop_name(self):
        self.assertEqual(self.report.rows[0][0], "Stop A")

    def test_the_trips_are_numbered(self):
        self.assertEqual(self.report.headers[1:], ("1", "2", "3", "4"))

    def test_the_times_run_down_a_column(self):
        column = [row[1] for row in self.report.rows]
        self.assertEqual(column, ["08:00", "08:05", "08:10", "08:15"])

    def test_the_headsign_is_noted(self):
        self.assertIn("Towards East.", self.report.notes)

    def test_a_window_narrows_the_columns(self):
        report = pattern_report(timetable(), "x-east", MONDAY, TimeWindow.parse("08:00-08:15"))
        self.assertEqual(len(report.headers), 3)

    def test_a_limit_narrows_the_columns(self):
        report = pattern_report(timetable(), "x-east", MONDAY, limit=1)
        self.assertEqual(len(report.headers), 2)

    def test_an_empty_day_says_so(self):
        report = pattern_report(timetable(), "y-south", SATURDAY)
        self.assertIn("Nothing runs on this date.", report.notes)

    def test_an_empty_day_still_lists_the_stops(self):
        report = pattern_report(timetable(), "y-south", SATURDAY)
        self.assertEqual(len(report), 4)

    def test_it_renders_as_text(self):
        self.assertIn("Stop A", self.report.as_text())


class RouteReportTest(unittest.TestCase):
    def test_one_report_per_pattern(self):
        self.assertEqual(len(route_report(timetable(), "x", MONDAY)), 2)

    def test_a_route_with_one_pattern(self):
        self.assertEqual(len(route_report(timetable(), "y", MONDAY)), 1)

    def test_the_reports_name_the_route(self):
        for report in route_report(timetable(), "x", MONDAY):
            with self.subTest(report=report.title):
                self.assertIn("X", report.title)

    def test_the_directions_have_different_stop_orders(self):
        east, west = route_report(timetable(), "x", MONDAY)
        self.assertEqual(east.rows[0][0], "Stop A")
        self.assertEqual(west.rows[0][0], "Stop D")

    def test_a_window_applies_to_every_pattern(self):
        reports = route_report(timetable(), "x", MONDAY, TimeWindow.parse("08:00-08:15"))
        for report in reports:
            with self.subTest(report=report.title):
                self.assertLessEqual(len(report.headers), 3)


if __name__ == "__main__":
    unittest.main()
