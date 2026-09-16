"""Stops, stations and entrances."""

import unittest

from layover.errors import NetworkError
from layover.geo import Point
from layover.network.stops import Stop, StopKind


class StopKindTest(unittest.TestCase):
    def test_reads_a_name(self):
        self.assertIs(StopKind.parse("station"), StopKind.STATION)

    def test_reads_a_feed_number(self):
        self.assertIs(StopKind.parse("1"), StopKind.STATION)

    def test_an_empty_field_is_a_plain_stop(self):
        self.assertIs(StopKind.parse(""), StopKind.STOP)

    def test_zero_is_a_plain_stop(self):
        self.assertIs(StopKind.parse("0"), StopKind.STOP)

    def test_two_is_an_entrance(self):
        self.assertIs(StopKind.parse("2"), StopKind.ENTRANCE)

    def test_passes_a_kind_through(self):
        self.assertIs(StopKind.parse(StopKind.STOP), StopKind.STOP)

    def test_rejects_nonsense(self):
        with self.assertRaises(NetworkError):
            StopKind.parse("halt")

    def test_renders_as_its_name(self):
        self.assertEqual(str(StopKind.ENTRANCE), "entrance")


class StopTest(unittest.TestCase):
    def setUp(self):
        self.stop = Stop("p3", "Hauptbahnhof", Point.of("52.5250", "13.3694"), "hbf", platform="3")

    def test_keeps_the_identifier(self):
        self.assertEqual(self.stop.stop_id, "p3")

    def test_trims_the_identifier(self):
        self.assertEqual(Stop("  p3 ", "Name").stop_id, "p3")

    def test_trims_the_name(self):
        self.assertEqual(Stop("p3", "  Name ").name, "Name")

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(NetworkError):
            Stop("  ", "Name")

    def test_rejects_an_empty_name(self):
        with self.assertRaises(NetworkError):
            Stop("p3", "   ")

    def test_a_position_is_optional(self):
        self.assertIsNone(Stop("p3", "Name").point)

    def test_a_plain_stop_can_be_called_at(self):
        self.assertTrue(self.stop.boardable)

    def test_a_station_cannot_be_called_at(self):
        self.assertFalse(Stop("hbf", "Hbf", kind=StopKind.STATION).boardable)

    def test_a_station_knows_it(self):
        self.assertTrue(Stop("hbf", "Hbf", kind="station").is_station)

    def test_a_station_cannot_have_a_parent(self):
        with self.assertRaises(NetworkError):
            Stop("hbf", "Hbf", parent="other", kind=StopKind.STATION)

    def test_an_entrance_needs_a_parent(self):
        with self.assertRaises(NetworkError):
            Stop("e1", "North entrance", kind=StopKind.ENTRANCE)

    def test_an_entrance_with_a_parent_is_fine(self):
        self.assertEqual(Stop("e1", "North", parent="hbf", kind="entrance").parent, "hbf")

    def test_a_stop_cannot_be_its_own_parent(self):
        with self.assertRaises(NetworkError):
            Stop("p3", "Name", parent="p3")

    def test_the_label_shows_the_platform(self):
        self.assertEqual(self.stop.label, "Hauptbahnhof (platform 3)")

    def test_the_label_of_a_stop_with_no_platform(self):
        self.assertEqual(Stop("m", "Markt").label, "Markt")

    def test_renders_name_and_identifier(self):
        self.assertEqual(str(self.stop), "Hauptbahnhof (p3)")

    def test_distance_between_two_stops(self):
        other = Stop("mkt", "Markt", Point.of("52.5200", "13.4050"))
        self.assertGreater(self.stop.distance_to(other), 1000)

    def test_distance_needs_both_positions(self):
        with self.assertRaises(NetworkError):
            self.stop.distance_to(Stop("mkt", "Markt"))

    def test_moving_to_another_station(self):
        self.assertEqual(self.stop.with_parent("other").parent, "other")

    def test_detaching_from_a_station(self):
        self.assertIsNone(self.stop.with_parent(None).parent)

    def test_changing_the_zone(self):
        self.assertEqual(self.stop.with_zone("B").zone, "B")

    def test_changing_the_zone_keeps_everything_else(self):
        moved = self.stop.with_zone("B")
        self.assertEqual((moved.stop_id, moved.name, moved.platform), ("p3", "Hauptbahnhof", "3"))

    def test_is_hashable(self):
        self.assertEqual(len({Stop("a", "A"), Stop("a", "A")}), 1)

    def test_equality_looks_at_every_field(self):
        self.assertNotEqual(Stop("a", "A"), Stop("a", "A", zone="B"))


if __name__ == "__main__":
    unittest.main()
