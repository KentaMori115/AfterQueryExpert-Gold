"""The assembled network and the indexes it keeps."""

import unittest

from layover.errors import NetworkError
from layover.network import NetworkBuilder
from tests.support import line_network


class LookupTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()

    def test_finds_a_stop(self):
        self.assertEqual(self.network.stop("a").name, "Stop A")

    def test_an_unknown_stop_raises(self):
        with self.assertRaises(NetworkError):
            self.network.stop("z")

    def test_finds_a_route(self):
        self.assertEqual(self.network.route("x").short_name, "X")

    def test_an_unknown_route_raises(self):
        with self.assertRaises(NetworkError):
            self.network.route("z")

    def test_finds_a_pattern(self):
        self.assertEqual(len(self.network.pattern("x-east")), 4)

    def test_an_unknown_pattern_raises(self):
        with self.assertRaises(NetworkError):
            self.network.pattern("z")

    def test_finds_a_trip(self):
        self.assertEqual(self.network.trip("x-east-0").service_id, "weekday")

    def test_an_unknown_trip_raises(self):
        with self.assertRaises(NetworkError):
            self.network.trip("z")

    def test_an_unknown_agency_raises(self):
        with self.assertRaises(NetworkError):
            self.network.agency("z")

    def test_membership_of_a_stop(self):
        self.assertIn("a", self.network)
        self.assertNotIn("z", self.network)

    def test_has_stop_agrees(self):
        self.assertTrue(self.network.has_stop("a"))
        self.assertFalse(self.network.has_stop("z"))

    def test_length_is_the_stop_count(self):
        self.assertEqual(len(self.network), 7)

    def test_iterating_gives_stops_in_order(self):
        self.assertEqual([stop.stop_id for stop in self.network], list(self.network.stop_ids()))


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()

    def test_identifiers_come_back_sorted(self):
        for listing in (
            self.network.stop_ids(),
            self.network.route_ids(),
            self.network.pattern_ids(),
            self.network.trip_ids(),
        ):
            with self.subTest(listing=listing[:1]):
                self.assertEqual(list(listing), sorted(listing))

    def test_patterns_at_an_interchange(self):
        found = dict(self.network.patterns_at("c"))
        self.assertEqual(set(found), {"x-east", "x-west", "y-south"})

    def test_a_pattern_records_its_position(self):
        self.assertEqual(dict(self.network.patterns_at("c"))["x-east"], 2)

    def test_a_stop_with_no_service_has_no_patterns(self):
        builder = NetworkBuilder.from_network(self.network)
        builder.stop("lonely", "Lonely", "52.4", "13.4")
        self.assertEqual(builder.build().patterns_at("lonely"), ())

    def test_patterns_at_an_unknown_stop_raises(self):
        with self.assertRaises(NetworkError):
            self.network.patterns_at("z")

    def test_patterns_of_a_route(self):
        self.assertEqual(self.network.patterns_of_route("x"), ("x-east", "x-west"))

    def test_trips_of_a_pattern_are_sorted_by_departure(self):
        trips = self.network.trips_of_pattern("x-east")
        self.assertEqual([trip.start_time for trip in trips], sorted(trip.start_time for trip in trips))

    def test_trips_of_a_pattern_include_every_service(self):
        self.assertEqual(len(self.network.trips_of_pattern("x-east")), 5)

    def test_trips_of_a_route_gather_both_directions(self):
        self.assertEqual(len(self.network.trips_of_route("x")), 9)

    def test_routes_at_a_stop(self):
        self.assertEqual(self.network.routes_at("c"), ("x", "y"))

    def test_routes_at_a_stop_on_one_line(self):
        self.assertEqual(self.network.routes_at("a"), ("x",))

    def test_service_identifiers_are_gathered(self):
        self.assertEqual(self.network.service_ids(), ("weekday", "weekend"))

    def test_stops_of_a_trip_come_from_its_pattern(self):
        self.assertEqual(self.network.stops_of_trip("y-south-0"), ("m", "n", "c", "p"))

    def test_counts_add_up(self):
        counts = self.network.counts()
        self.assertEqual(counts["stops"], 7)
        self.assertEqual(counts["routes"], 2)
        self.assertEqual(counts["patterns"], 3)

    def test_the_summary_names_everything(self):
        self.assertIn("7 stops", self.network.summary())

    def test_renders_with_its_name(self):
        self.assertTrue(str(self.network).startswith("toy: "))

    def test_the_bounding_box_holds_every_stop(self):
        box = self.network.bounding_box()
        for stop in self.network:
            with self.subTest(stop=stop.stop_id):
                self.assertTrue(box.contains(stop.point))


class StationTest(unittest.TestCase):
    def setUp(self):
        builder = NetworkBuilder("stations")
        builder.station("hbf", "Hauptbahnhof", "52.525", "13.369", [("1", "1"), ("2", "2")])
        builder.stop("markt", "Markt", "52.520", "13.405")
        builder.route("r", "R")
        builder.pattern("r-out", "r", ["hbf-1", "markt"])
        builder.trip("t", "r-out", "weekday", ["08:00", "08:10"])
        builder.transfer("hbf-1", "hbf-2", 90, kind="in-station")
        self.network = builder.build()

    def test_a_platform_belongs_to_its_station(self):
        self.assertEqual(self.network.station_of("hbf-1"), "hbf")

    def test_a_street_stop_has_no_station(self):
        self.assertIsNone(self.network.station_of("markt"))

    def test_a_station_lists_its_platforms(self):
        self.assertEqual(self.network.children_of("hbf"), ("hbf-1", "hbf-2"))

    def test_a_platform_has_siblings(self):
        self.assertEqual(self.network.siblings_of("hbf-1"), ("hbf-2",))

    def test_a_street_stop_has_no_siblings(self):
        self.assertEqual(self.network.siblings_of("markt"), ())

    def test_transfers_leaving_a_platform(self):
        self.assertEqual(len(self.network.transfers_from("hbf-1")), 1)

    def test_a_stop_with_no_transfers(self):
        self.assertEqual(self.network.transfers_from("markt"), ())

    def test_transfer_time_between_platforms(self):
        self.assertEqual(self.network.transfer_time("hbf-1", "hbf-2"), 90)

    def test_transfer_to_the_same_stop_is_free(self):
        self.assertEqual(self.network.transfer_time("hbf-1", "hbf-1"), 0)

    def test_no_transfer_between_unconnected_stops(self):
        self.assertIsNone(self.network.transfer_time("hbf-1", "markt"))

    def test_transfers_come_back_quickest_first(self):
        transfers = self.network.transfers_from("hbf-1")
        self.assertEqual([t.seconds for t in transfers], sorted(t.seconds for t in transfers))


if __name__ == "__main__":
    unittest.main()
