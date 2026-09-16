"""Departure and arrival boards."""

import unittest
from datetime import date

from layover.report.board import arrival_board, departure_board, stop_summary
from layover.timetable import Timetable
from layover.times import parse_clock
from tests.support import MONDAY, SATURDAY, line_network, services


def timetable():
    return Timetable(line_network(), services())


class DepartureBoardTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()
        self.report = departure_board(self.timetable, "c", MONDAY, limit=4)

    def test_the_title_names_the_stop_and_date(self):
        self.assertEqual(self.report.title, "Departures from Stop C, 2026-07-06")

    def test_a_row_per_departure(self):
        self.assertEqual(len(self.report), 4)

    def test_the_columns_are_named(self):
        self.assertEqual(self.report.headers, ("Time", "Route", "Towards", "Trip"))

    def test_the_first_row_is_the_earliest(self):
        self.assertEqual(self.report.rows[0][0], "08:06")

    def test_the_route_name_is_shown(self):
        self.assertEqual(self.report.rows[0][1], "X")

    def test_the_headsign_is_shown(self):
        self.assertEqual(self.report.rows[0][2], "West")

    def test_a_limit_is_respected(self):
        self.assertEqual(len(departure_board(self.timetable, "c", MONDAY, limit=2)), 2)

    def test_a_start_time_is_respected(self):
        report = departure_board(self.timetable, "a", MONDAY, after=parse_clock("08:15"))
        self.assertEqual(report.rows[0][0], "08:20")

    def test_a_route_filter_is_respected(self):
        report = departure_board(self.timetable, "c", MONDAY, routes=["y"])
        self.assertEqual({row[1] for row in report.rows}, {"Y"})

    def test_an_empty_board_says_so(self):
        report = departure_board(self.timetable, "m", SATURDAY)
        self.assertIn("Nothing leaves here on this date.", report.notes)

    def test_an_empty_board_has_no_rows(self):
        self.assertTrue(departure_board(self.timetable, "m", SATURDAY).is_empty)

    def test_a_dead_date_gives_an_empty_board(self):
        self.assertTrue(departure_board(self.timetable, "a", date(2026, 6, 1)).is_empty)

    def test_the_board_renders_as_text(self):
        self.assertIn("08:06", self.report.as_text())

    def test_the_board_renders_as_csv(self):
        self.assertTrue(self.report.as_csv().startswith("Time,Route,Towards,Trip"))


class ArrivalBoardTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()
        self.report = arrival_board(self.timetable, "d", MONDAY, limit=3)

    def test_the_title_names_the_stop(self):
        self.assertTrue(self.report.title.startswith("Arrivals at Stop D"))

    def test_a_row_per_arrival(self):
        self.assertEqual(len(self.report), 3)

    def test_the_origin_is_shown(self):
        self.assertEqual(self.report.rows[0][2], "a")

    def test_the_rows_are_in_time_order(self):
        times = [row[0] for row in self.report.rows]
        self.assertEqual(times, sorted(times))

    def test_an_empty_board_says_so(self):
        report = arrival_board(self.timetable, "p", SATURDAY)
        self.assertIn("Nothing arrives here on this date.", report.notes)


class StopSummaryTest(unittest.TestCase):
    def setUp(self):
        self.report = stop_summary(timetable(), MONDAY)

    def test_a_row_per_stop(self):
        self.assertEqual(len(self.report), 7)

    def test_the_stops_are_in_identifier_order(self):
        self.assertEqual([row[0] for row in self.report.rows], list("abcdmnp"))

    def test_the_call_count_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "c"][0]
        self.assertEqual(row[2], "12")

    def test_the_routes_are_listed(self):
        row = [row for row in self.report.rows if row[0] == "c"][0]
        self.assertEqual(row[3], "x, y")

    def test_the_service_span_is_shown(self):
        row = [row for row in self.report.rows if row[0] == "a"][0]
        self.assertEqual(row[4], "08:00-08:30")

    def test_a_stop_with_no_departures_has_no_span(self):
        row = [row for row in self.report.rows if row[0] == "p"][0]
        self.assertEqual(row[4], "")


if __name__ == "__main__":
    unittest.main()
