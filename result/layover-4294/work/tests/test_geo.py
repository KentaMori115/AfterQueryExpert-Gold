"""Positions, distances and bounding boxes in microdegrees."""

import unittest
from decimal import Decimal

from layover.errors import FeedError, Location
from layover.geo import (
    BoundingBox,
    EARTH_RADIUS_METRES,
    MICRO,
    Point,
    centre_of,
    distance_metres,
    format_degrees,
    parse_degrees,
    walk_seconds,
)


class ParseDegreesTest(unittest.TestCase):
    def test_reads_a_decimal_string(self):
        self.assertEqual(parse_degrees("52.516300"), 52516300)

    def test_reads_a_short_string(self):
        self.assertEqual(parse_degrees("13.3"), 13300000)

    def test_reads_a_negative(self):
        self.assertEqual(parse_degrees("-0.127600"), -127600)

    def test_reads_an_integer(self):
        self.assertEqual(parse_degrees(13), 13000000)

    def test_reads_a_decimal_object(self):
        self.assertEqual(parse_degrees(Decimal("1.5")), 1500000)

    def test_rounds_half_away_from_zero(self):
        self.assertEqual(parse_degrees("0.0000005"), 1)

    def test_rounds_a_negative_half_away_from_zero(self):
        self.assertEqual(parse_degrees("-0.0000005"), -1)

    def test_rounds_down_below_half(self):
        self.assertEqual(parse_degrees("0.00000049"), 0)

    def test_rejects_empty(self):
        with self.assertRaises(FeedError):
            parse_degrees("  ")

    def test_rejects_letters(self):
        with self.assertRaises(FeedError):
            parse_degrees("north")

    def test_rejects_a_float(self):
        with self.assertRaises(FeedError):
            parse_degrees(52.5163)

    def test_carries_the_place(self):
        where = Location("stops", 4, "lat")
        with self.assertRaises(FeedError) as caught:
            parse_degrees("nope", where)
        self.assertIs(caught.exception.where, where)


class FormatDegreesTest(unittest.TestCase):
    def test_always_six_places(self):
        self.assertEqual(format_degrees(52500000), "52.500000")

    def test_keeps_the_precision_it_has(self):
        self.assertEqual(format_degrees(52516300), "52.516300")

    def test_writes_a_negative(self):
        self.assertEqual(format_degrees(-127600), "-0.127600")

    def test_writes_zero(self):
        self.assertEqual(format_degrees(0), "0.000000")

    def test_reads_back_to_the_same_number(self):
        for value in (0, 1, -1, 52516300, -127600, 180000000):
            with self.subTest(value=value):
                self.assertEqual(parse_degrees(format_degrees(value)), value)


class PointTest(unittest.TestCase):
    def setUp(self):
        self.middle = Point.of("52.5163", "13.3777")

    def test_holds_microdegrees(self):
        self.assertEqual(self.middle.lat, 52516300)

    def test_gives_degrees_back_exactly(self):
        self.assertEqual(self.middle.degrees(), (Decimal("52.5163"), Decimal("13.3777")))

    def test_renders_as_a_pair(self):
        self.assertEqual(str(self.middle), "52.5163,13.3777")

    def test_parses_what_it_renders(self):
        self.assertEqual(Point.parse(str(self.middle)), self.middle)

    def test_parse_rejects_a_lone_number(self):
        with self.assertRaises(FeedError):
            Point.parse("52.5163")

    def test_rejects_an_impossible_latitude(self):
        with self.assertRaises(FeedError):
            Point(91 * MICRO, 0)

    def test_rejects_an_impossible_longitude(self):
        with self.assertRaises(FeedError):
            Point(0, 181 * MICRO)

    def test_accepts_the_poles(self):
        self.assertEqual(Point(90 * MICRO, 0).lat, 90 * MICRO)

    def test_equal_positions_compare_equal(self):
        self.assertEqual(Point.of("1", "2"), Point.of("1.0", "2.0"))

    def test_points_are_hashable(self):
        self.assertEqual(len({Point.of("1", "2"), Point.of("1", "2")}), 1)

    def test_points_order_by_latitude(self):
        self.assertLess(Point.of("1", "9"), Point.of("2", "0"))

    def test_moving_north_raises_the_latitude(self):
        self.assertGreater(self.middle.moved(north_metres=500).lat, self.middle.lat)

    def test_moving_east_raises_the_longitude(self):
        self.assertGreater(self.middle.moved(east_metres=500).lon, self.middle.lon)

    def test_moving_nowhere_stays_put(self):
        self.assertEqual(self.middle.moved(), self.middle)

    def test_a_move_is_about_the_distance_asked_for(self):
        moved = self.middle.moved(north_metres=1000)
        self.assertAlmostEqual(distance_metres(self.middle, moved), 1000, delta=2)


class DistanceTest(unittest.TestCase):
    def setUp(self):
        self.first = Point.of("52.5163", "13.3777")
        self.second = Point.of("52.5200", "13.4050")

    def test_a_point_is_no_distance_from_itself(self):
        self.assertEqual(distance_metres(self.first, self.first), 0)

    def test_distance_is_symmetric(self):
        self.assertEqual(
            distance_metres(self.first, self.second), distance_metres(self.second, self.first)
        )

    def test_distance_is_a_whole_number(self):
        self.assertIsInstance(distance_metres(self.first, self.second), int)

    def test_a_known_hop(self):
        self.assertAlmostEqual(distance_metres(self.first, self.second), 1892, delta=5)

    def test_a_degree_of_latitude(self):
        north = Point(self.first.lat + MICRO, self.first.lon)
        self.assertAlmostEqual(distance_metres(self.first, north), 111195, delta=50)

    def test_the_triangle_inequality_holds(self):
        middle = Point((self.first.lat + self.second.lat) // 2, self.first.lon)
        direct = distance_metres(self.first, self.second)
        around = distance_metres(self.first, middle) + distance_metres(middle, self.second)
        self.assertLessEqual(direct, around)

    def test_half_the_world_is_half_the_circumference(self):
        pole_to_pole = distance_metres(Point(-90 * MICRO, 0), Point(90 * MICRO, 0))
        self.assertAlmostEqual(pole_to_pole, int(3.14159265 * EARTH_RADIUS_METRES), delta=10)


class WalkTest(unittest.TestCase):
    def test_a_kilometre_at_the_default_speed(self):
        self.assertEqual(walk_seconds(1000), 800)

    def test_no_distance_takes_no_time(self):
        self.assertEqual(walk_seconds(0), 0)

    def test_rounds_up_to_the_next_second(self):
        self.assertEqual(walk_seconds(1), 1)

    def test_a_slower_walker_takes_longer(self):
        self.assertGreater(walk_seconds(1000, 3000), walk_seconds(1000, 5000))

    def test_rejects_a_negative_distance(self):
        with self.assertRaises(FeedError):
            walk_seconds(-1)

    def test_rejects_a_still_walker(self):
        with self.assertRaises(FeedError):
            walk_seconds(100, 0)


class BoundingBoxTest(unittest.TestCase):
    def setUp(self):
        self.points = [Point.of("52.51", "13.37"), Point.of("52.53", "13.41"), Point.of("52.49", "13.39")]
        self.box = BoundingBox.of(self.points)

    def test_holds_every_point(self):
        for point in self.points:
            with self.subTest(point=point):
                self.assertTrue(self.box.contains(point))

    def test_misses_a_point_outside(self):
        self.assertFalse(self.box.contains(Point.of("52.60", "13.37")))

    def test_the_south_edge_is_the_lowest_latitude(self):
        self.assertEqual(self.box.south, min(point.lat for point in self.points))

    def test_the_east_edge_is_the_highest_longitude(self):
        self.assertEqual(self.box.east, max(point.lon for point in self.points))

    def test_expanding_takes_in_a_new_point(self):
        outside = Point.of("52.60", "13.37")
        self.assertTrue(self.box.expand(outside).contains(outside))

    def test_expanding_with_an_inside_point_changes_nothing(self):
        self.assertEqual(self.box.expand(self.points[0]), self.box)

    def test_padding_grows_the_box(self):
        padded = self.box.pad(500)
        self.assertLess(padded.south, self.box.south)
        self.assertGreater(padded.north, self.box.north)

    def test_width_is_measured_in_metres(self):
        self.assertGreater(self.box.width_metres, 0)

    def test_height_is_measured_in_metres(self):
        self.assertGreater(self.box.height_metres, 0)

    def test_a_single_point_box_has_no_size(self):
        one = BoundingBox.of([self.points[0]])
        self.assertEqual(one.width_metres, 0)
        self.assertEqual(one.height_metres, 0)

    def test_rejects_no_points(self):
        with self.assertRaises(FeedError):
            BoundingBox.of([])

    def test_rejects_an_inside_out_box(self):
        with self.assertRaises(FeedError):
            BoundingBox(10, 0, 0, 10)

    def test_renders_as_two_corners(self):
        self.assertIn("..", str(self.box))

    def test_the_centre_is_inside(self):
        self.assertTrue(self.box.contains(centre_of(self.points)))

    def test_the_centre_of_one_point_is_that_point(self):
        self.assertEqual(centre_of([self.points[0]]), self.points[0])


if __name__ == "__main__":
    unittest.main()
