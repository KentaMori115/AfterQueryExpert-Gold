"""Fare zones and the stops inside them."""

import unittest

from layover.errors import FareError
from layover.fares.zones import ZoneMap
from layover.network import NetworkBuilder
from tests.support import line_network


class ZoneMapTest(unittest.TestCase):
    def setUp(self):
        self.zones = ZoneMap({"a": "A", "b": "A", "c": "B"})

    def test_finds_a_zone(self):
        self.assertEqual(self.zones.zone_of("a"), "A")

    def test_an_unzoned_stop_raises(self):
        with self.assertRaises(FareError):
            self.zones.zone_of("z")

    def test_find_returns_nothing_for_an_unzoned_stop(self):
        self.assertIsNone(self.zones.find("z"))

    def test_membership(self):
        self.assertIn("a", self.zones)
        self.assertNotIn("z", self.zones)

    def test_counts_the_stops(self):
        self.assertEqual(len(self.zones), 3)

    def test_zones_come_back_sorted(self):
        self.assertEqual(self.zones.zones(), ("A", "B"))

    def test_stops_in_a_zone(self):
        self.assertEqual(self.zones.stops_in("A"), ("a", "b"))

    def test_stops_in_an_unknown_zone(self):
        self.assertEqual(self.zones.stops_in("Z"), ())

    def test_assigning_replaces(self):
        self.zones.assign("a", "B")
        self.assertEqual(self.zones.zone_of("a"), "B")

    def test_assigning_trims(self):
        self.zones.assign(" d ", " C ")
        self.assertEqual(self.zones.zone_of("d"), "C")

    def test_assigning_needs_a_stop(self):
        with self.assertRaises(FareError):
            self.zones.assign("  ", "A")

    def test_assigning_needs_a_zone(self):
        with self.assertRaises(FareError):
            self.zones.assign("d", "  ")

    def test_unzoned_stops_are_listed(self):
        self.assertEqual(self.zones.unzoned(["a", "y", "z"]), ("y", "z"))

    def test_nothing_unzoned(self):
        self.assertEqual(self.zones.unzoned(["a", "b"]), ())

    def test_counts_by_zone(self):
        self.assertEqual(self.zones.counts(), {"A": 2, "B": 1})

    def test_renders_a_summary(self):
        self.assertEqual(str(self.zones), "3 stops in 2 zones")

    def test_an_empty_map(self):
        self.assertEqual(len(ZoneMap()), 0)
        self.assertEqual(ZoneMap().zones(), ())


class FromNetworkTest(unittest.TestCase):
    def test_reads_the_zones_off_the_stops(self):
        zones = ZoneMap.of_network(line_network())
        self.assertEqual(zones.zones(), ("A",))

    def test_covers_every_stop(self):
        network = line_network()
        zones = ZoneMap.of_network(network)
        self.assertEqual(len(zones), len(network))

    def test_a_platform_inherits_from_its_station(self):
        builder = NetworkBuilder()
        builder.station("hbf", "Hbf", "52.5", "13.4", [("1", "1")])
        builder.stop("markt", "Markt", "52.5", "13.5", zone="B")
        builder.route("r", "R")
        builder.pattern("p", "r", ["hbf-1", "markt"])
        builder.trip("t", "p", "s", ["08:00", "08:10"])
        network = builder.build()
        network = NetworkBuilder.from_network(network).build()
        zones = ZoneMap.of_network(
            NetworkBuilder.from_network(network).build()
        )
        self.assertEqual(zones.find("hbf-1"), None)

    def test_a_station_zone_reaches_its_platform(self):
        builder = NetworkBuilder()
        builder.stop("hbf", "Hbf", "52.5", "13.4", kind="station", zone="A")
        builder.stop("hbf-1", "Hbf", "52.5", "13.4", parent="hbf")
        builder.stop("markt", "Markt", "52.5", "13.5", zone="B")
        builder.route("r", "R")
        builder.pattern("p", "r", ["hbf-1", "markt"])
        builder.trip("t", "p", "s", ["08:00", "08:10"])
        zones = ZoneMap.of_network(builder.build())
        self.assertEqual(zones.zone_of("hbf-1"), "A")

    def test_an_unzoned_network_gives_an_empty_map(self):
        builder = NetworkBuilder()
        builder.stop("a", "A")
        builder.stop("b", "B")
        builder.route("r", "R")
        builder.pattern("p", "r", ["a", "b"])
        builder.trip("t", "p", "s", ["08:00", "08:10"])
        self.assertEqual(len(ZoneMap.of_network(builder.build())), 0)


if __name__ == "__main__":
    unittest.main()
