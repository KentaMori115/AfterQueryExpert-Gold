"""Laying a pattern's trips out as a grid."""

import unittest

from layover.errors import PlanError
from layover.timetable import Grid, Timetable, pattern_grid, route_grids
from layover.times import TimeWindow, parse_clock
from tests.support import MONDAY, SATURDAY, line_network, services


def timetable():
    return Timetable(line_network(), services())


class GridTest(unittest.TestCase):
    def setUp(self):
        self.grid = pattern_grid(timetable(), "x-east", MONDAY)

    def test_a_row_per_stop(self):
        self.assertEqual(len(self.grid.times), 4)

    def test_a_column_per_trip(self):
        self.assertEqual(len(self.grid.trips), 4)

    def test_the_stops_are_the_pattern(self):
        self.assertEqual(self.grid.stops, ("a", "b", "c", "d"))

    def test_the_route_comes_along(self):
        self.assertEqual(self.grid.route_id, "x")

    def test_the_headsign_comes_along(self):
        self.assertEqual(self.grid.headsign, "East")

    def test_a_column_is_one_trip(self):
        self.assertEqual(self.grid.column("x-east-0")[0], parse_clock("08:00"))

    def test_a_column_runs_down_the_pattern(self):
        column = self.grid.column("x-east-0")
        self.assertEqual(list(column), sorted(column))

    def test_an_unknown_trip_raises(self):
        with self.assertRaises(PlanError):
            self.grid.column("nope")

    def test_a_row_is_one_stop(self):
        self.assertEqual(self.grid.row("a")[0], parse_clock("08:00"))

    def test_a_row_runs_across_the_trips(self):
        row = self.grid.row("a")
        self.assertEqual(list(row), sorted(row))

    def test_an_unknown_stop_raises(self):
        with self.assertRaises(PlanError):
            self.grid.row("nope")

    def test_the_first_departure(self):
        self.assertEqual(self.grid.first_departure(), parse_clock("08:00"))

    def test_the_last_departure(self):
        self.assertEqual(self.grid.last_departure(), parse_clock("08:30"))

    def test_a_full_grid_is_not_empty(self):
        self.assertFalse(self.grid.is_empty)

    def test_the_text_rows_are_short_times(self):
        self.assertEqual(self.grid.as_text_rows()[0][0], "08:00")

    def test_the_text_rows_line_up(self):
        rows = self.grid.as_text_rows()
        self.assertEqual({len(row) for row in rows}, {4})

    def test_cutting_to_two_trips(self):
        cut = self.grid.limited(2)
        self.assertEqual(len(cut.trips), 2)

    def test_cutting_keeps_the_rows(self):
        self.assertEqual(len(self.grid.limited(2).times), 4)

    def test_cutting_to_nothing(self):
        self.assertTrue(self.grid.limited(0).is_empty)

    def test_cutting_below_zero_raises(self):
        with self.assertRaises(PlanError):
            self.grid.limited(-1)

    def test_renders_its_shape(self):
        self.assertEqual(str(self.grid), "x-east: 4 stops by 4 trips")

    def test_a_grid_needs_a_row_per_stop(self):
        with self.assertRaises(PlanError):
            Grid("p", "r", ("a", "b"), ("t",), ((1,),))

    def test_a_grid_needs_a_time_per_trip(self):
        with self.assertRaises(PlanError):
            Grid("p", "r", ("a",), ("t", "u"), ((1,),))


class BuildGridTest(unittest.TestCase):
    def setUp(self):
        self.timetable = timetable()

    def test_a_quiet_day_gives_a_thin_grid(self):
        grid = pattern_grid(self.timetable, "x-east", SATURDAY)
        self.assertEqual(len(grid.trips), 1)

    def test_a_dead_pattern_gives_an_empty_grid(self):
        grid = pattern_grid(self.timetable, "y-south", SATURDAY)
        self.assertTrue(grid.is_empty)

    def test_an_empty_grid_has_no_first_departure(self):
        self.assertIsNone(pattern_grid(self.timetable, "y-south", SATURDAY).first_departure())

    def test_a_window_narrows_the_trips(self):
        window = TimeWindow.parse("08:00-08:15")
        grid = pattern_grid(self.timetable, "x-east", MONDAY, window)
        self.assertEqual(len(grid.trips), 2)

    def test_a_limit_narrows_the_trips(self):
        grid = pattern_grid(self.timetable, "x-east", MONDAY, limit=3)
        self.assertEqual(len(grid.trips), 3)

    def test_a_route_gives_a_grid_per_pattern(self):
        grids = route_grids(self.timetable, "x", MONDAY)
        self.assertEqual([grid.pattern_id for grid in grids], ["x-east", "x-west"])

    def test_a_route_with_one_pattern(self):
        self.assertEqual(len(route_grids(self.timetable, "y", MONDAY)), 1)

    def test_route_grids_take_a_window(self):
        window = TimeWindow.parse("08:00-08:15")
        grids = route_grids(self.timetable, "x", MONDAY, window)
        self.assertTrue(all(len(grid.trips) <= 2 for grid in grids))


if __name__ == "__main__":
    unittest.main()
