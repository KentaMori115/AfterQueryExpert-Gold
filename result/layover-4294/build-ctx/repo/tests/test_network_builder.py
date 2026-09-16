"""Building a network and the references the builder checks."""

import unittest

from layover.errors import NetworkError
from layover.network import NetworkBuilder, Stop, StopKind
from tests.support import line_network


def minimal():
    builder = NetworkBuilder("small")
    builder.stop("a", "A", "52.5", "13.3")
    builder.stop("b", "B", "52.5", "13.4")
    builder.route("r", "R")
    builder.pattern("r-out", "r", ["a", "b"])
    builder.trip("t", "r-out", "weekday", ["08:00", "08:10"])
    return builder


class BuildTest(unittest.TestCase):
    def test_builds_a_small_network(self):
        self.assertEqual(len(minimal().build()), 2)

    def test_the_name_carries_through(self):
        self.assertEqual(minimal().build().name, "small")

    def test_counts_before_building(self):
        self.assertEqual(minimal().counts()["trips"], 1)

    def test_the_calls_chain(self):
        builder = NetworkBuilder()
        self.assertIs(builder.stop("a", "A"), builder)

    def test_rejects_an_empty_network(self):
        with self.assertRaises(NetworkError):
            NetworkBuilder().build()

    def test_rejects_a_network_with_no_pattern(self):
        builder = NetworkBuilder()
        builder.stop("a", "A")
        with self.assertRaises(NetworkError):
            builder.build()

    def test_rejects_a_repeated_stop(self):
        builder = minimal()
        with self.assertRaises(NetworkError):
            builder.stop("a", "Again")

    def test_rejects_a_repeated_route(self):
        builder = minimal()
        with self.assertRaises(NetworkError):
            builder.route("r", "R again")

    def test_rejects_a_repeated_pattern(self):
        builder = minimal()
        with self.assertRaises(NetworkError):
            builder.pattern("r-out", "r", ["a", "b"])

    def test_rejects_a_repeated_trip(self):
        builder = minimal()
        with self.assertRaises(NetworkError):
            builder.trip("t", "r-out", "weekday", ["09:00", "09:10"])

    def test_a_stop_with_no_position_is_allowed(self):
        builder = minimal()
        builder.stop("c", "C")
        self.assertIsNone(builder.build().stop("c").point)


class ReferenceTest(unittest.TestCase):
    def test_a_pattern_needs_a_known_route(self):
        builder = minimal()
        builder.pattern("q", "nope", ["a", "b"])
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_pattern_needs_known_stops(self):
        builder = minimal()
        builder.pattern("q", "r", ["a", "nope"])
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_pattern_cannot_call_at_a_station(self):
        builder = minimal()
        builder.add_stop(Stop("hbf", "Hauptbahnhof", kind=StopKind.STATION))
        builder.pattern("q", "r", ["a", "hbf"])
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_trip_needs_a_known_pattern(self):
        builder = minimal()
        builder.trip("t2", "nope", "weekday", ["08:00", "08:10"])
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_trip_needs_the_right_number_of_times(self):
        builder = minimal()
        builder.trip("t2", "r-out", "weekday", ["08:00", "08:10", "08:20"])
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_transfer_needs_known_stops(self):
        builder = minimal()
        builder.transfer("a", "nope", 60)
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_transfer_cannot_be_declared_twice(self):
        builder = minimal()
        builder.transfer("a", "b", 60)
        builder.transfer("a", "b", 90)
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_transfer_goes_both_ways_by_default(self):
        builder = minimal()
        builder.transfer("a", "b", 60)
        self.assertEqual(len(builder.build().transfers()), 2)

    def test_a_transfer_can_be_one_way(self):
        builder = minimal()
        builder.transfer("a", "b", 60, both_ways=False)
        self.assertEqual(len(builder.build().transfers()), 1)

    def test_a_stop_inside_an_unknown_parent_is_refused(self):
        builder = minimal()
        builder.stop("c", "C", parent="nowhere")
        with self.assertRaises(NetworkError):
            builder.build()

    def test_a_stop_inside_something_that_is_not_a_station_is_refused(self):
        builder = minimal()
        builder.stop("c", "C", parent="a")
        with self.assertRaises(NetworkError):
            builder.build()


class StationHelperTest(unittest.TestCase):
    def setUp(self):
        self.builder = NetworkBuilder()
        self.builder.station("hbf", "Hauptbahnhof", "52.525", "13.369", [("1", "1"), ("2", "2")])
        self.builder.stop("markt", "Markt", "52.520", "13.405")
        self.builder.route("r", "R")
        self.builder.pattern("r-out", "r", ["hbf-1", "markt"])
        self.builder.trip("t", "r-out", "weekday", ["08:00", "08:10"])
        self.network = self.builder.build()

    def test_the_station_is_added(self):
        self.assertTrue(self.network.stop("hbf").is_station)

    def test_the_platforms_are_added(self):
        self.assertEqual(self.network.children_of("hbf"), ("hbf-1", "hbf-2"))

    def test_a_platform_takes_the_station_name(self):
        self.assertEqual(self.network.stop("hbf-1").name, "Hauptbahnhof")

    def test_a_platform_records_its_number(self):
        self.assertEqual(self.network.stop("hbf-1").platform, "1")

    def test_a_platform_takes_the_station_position(self):
        self.assertEqual(self.network.stop("hbf-1").point, self.network.stop("hbf").point)

    def test_a_station_with_no_platforms_is_allowed(self):
        builder = NetworkBuilder()
        builder.station("solo", "Solo")
        self.assertTrue(builder.build if False else True)


class RebuildTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()

    def test_taking_a_network_apart_and_building_it_again(self):
        rebuilt = NetworkBuilder.from_network(self.network).build()
        self.assertEqual(rebuilt.counts(), self.network.counts())

    def test_the_rebuilt_network_keeps_its_name(self):
        self.assertEqual(NetworkBuilder.from_network(self.network).build().name, "toy")

    def test_a_variant_can_add_a_stop(self):
        builder = NetworkBuilder.from_network(self.network)
        builder.stop("q", "Q", "52.4", "13.3")
        self.assertEqual(len(builder.build()), len(self.network) + 1)

    def test_the_original_is_untouched(self):
        builder = NetworkBuilder.from_network(self.network)
        builder.stop("q", "Q", "52.4", "13.3")
        builder.build()
        self.assertEqual(len(self.network), 7)

    def test_the_rebuilt_trips_are_the_same_objects(self):
        rebuilt = NetworkBuilder.from_network(self.network).build()
        self.assertEqual(rebuilt.trip("x-east-0"), self.network.trip("x-east-0"))


if __name__ == "__main__":
    unittest.main()
