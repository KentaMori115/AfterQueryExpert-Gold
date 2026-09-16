"""Summaries of a network, its routes and its calendars."""

import unittest
from datetime import date

from layover.report.summary import (
    calendar_report,
    network_report,
    route_report_lines,
    service_day_report,
)
from layover.timetable import Timetable
from tests.support import MONDAY, SATURDAY, line_network, services


def timetable():
    return Timetable(line_network(), services())


class NetworkReportTest(unittest.TestCase):
    def setUp(self):
        self.report = network_report(timetable())

    def test_the_title_is_the_network_name(self):
        self.assertEqual(self.report.title, "toy")

    def test_a_row_per_count(self):
        self.assertEqual(len(self.report), 7)

    def test_the_stop_count_is_right(self):
        row = [row for row in self.report.rows if row[0] == "stops"][0]
        self.assertEqual(row[1], "7")

    def test_the_service_count_is_included(self):
        row = [row for row in self.report.rows if row[0] == "services"][0]
        self.assertEqual(row[1], "2")

    def test_the_span_is_noted(self):
        self.assertTrue(any("Service runs" in note for note in self.report.notes))

    def test_the_modes_are_noted(self):
        self.assertTrue(any("bus, tram" in note for note in self.report.notes))


class RouteReportTest(unittest.TestCase):
    def setUp(self):
        self.report = route_report_lines(timetable(), MONDAY)

    def test_a_row_per_route(self):
        self.assertEqual(len(self.report), 2)

    def test_the_pattern_count(self):
        row = [row for row in self.report.rows if row[0] == "x"][0]
        self.assertEqual(row[3], "2")

    def test_the_trip_count(self):
        row = [row for row in self.report.rows if row[0] == "x"][0]
        self.assertEqual(row[4], "8")

    def test_the_mode_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "y"][0]
        self.assertEqual(row[2], "bus")

    def test_a_quiet_day_has_fewer_trips(self):
        report = route_report_lines(timetable(), SATURDAY)
        row = [row for row in report.rows if row[0] == "x"][0]
        self.assertEqual(row[4], "1")


class ServiceDayReportTest(unittest.TestCase):
    def test_a_row_per_running_route(self):
        self.assertEqual(len(service_day_report(timetable(), MONDAY)), 2)

    def test_only_the_running_routes_appear(self):
        report = service_day_report(timetable(), SATURDAY)
        self.assertEqual([row[0] for row in report.rows], ["X"])

    def test_the_first_and_last_departure(self):
        report = service_day_report(timetable(), MONDAY)
        row = [row for row in report.rows if row[0] == "X"][0]
        self.assertEqual((row[2], row[3]), ("08:00", "08:31"))

    def test_a_dead_date_says_so(self):
        report = service_day_report(timetable(), date(2026, 6, 1))
        self.assertIn("Nothing runs on this date.", report.notes)


class CalendarReportTest(unittest.TestCase):
    def setUp(self):
        self.report = calendar_report(timetable())

    def test_a_row_per_calendar(self):
        self.assertEqual(len(self.report), 2)

    def test_the_day_count_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "weekday"][0]
        self.assertEqual(row[1], "23")

    def test_the_calendar_is_described(self):
        row = [row for row in self.report.rows if row[0] == "weekday"][0]
        self.assertTrue(row[2].startswith("Mon-Fri"))

    def test_the_span_is_noted(self):
        self.assertTrue(any("Covering" in note for note in self.report.notes))


if __name__ == "__main__":
    unittest.main()
