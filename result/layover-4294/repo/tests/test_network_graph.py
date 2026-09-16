"""The network seen as a graph, with the timetable ignored."""

import unittest

from layover.errors import NetworkError
from layover.network import NetworkBuilder
from layover.network.graph import (
    components,
    hops_between,
    is_connected,
    neighbours,
    reachable_stops,
    route_neighbours,
    stop_graph,
)
from tests.support import line_network, transfer_network


def split_network():
    """Two networks in one file, with nothing joining them."""
    builder = NetworkBuilder("split")
    for stop_id in ("a", "b", "y", "z"):
        builder.stop(stop_id, stop_id.upper(), "52.5", "13.4")
    builder.route("first", "F")
    builder.route("second", "S")
    builder.pattern("first-out", "first", ["a", "b"])
    builder.pattern("second-out", "second", ["y", "z"])
    builder.trip("f1", "first-out", "weekday", ["08:00", "08:10"])
    builder.trip("s1", "second-out", "weekday", ["08:00", "08:10"])
    return builder.build()


class NeighbourTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()

    def test_the_next_stop_along_is_a_neighbour(self):
        self.assertIn("b", neighbours(self.network, "a"))

    def test_the_stop_before_is_a_neighbour_of_the_other_direction(self):
        self.assertIn("c", neighbours(self.network, "d"))

    def test_the_interchange_has_several(self):
        self.assertEqual(neighbours(self.network, "c"), ("b", "d", "p"))

    def test_a_terminus_has_only_the_way_back(self):
        self.assertEqual(neighbours(self.network, "p"), ())

    def test_an_unknown_stop_raises(self):
        with self.assertRaises(NetworkError):
            neighbours(self.network, "z")

    def test_a_transfer_makes_a_neighbour(self):
        network = transfer_network()
        self.assertIn("y", neighbours(network, "x"))

    def test_walking_can_be_switched_off(self):
        network = transfer_network()
        self.assertNotIn("y", neighbours(network, "x", walking=False))

    def test_the_graph_holds_every_stop(self):
        self.assertEqual(set(stop_graph(self.network)), set(self.network.stop_ids()))

    def test_the_graph_agrees_with_the_neighbours(self):
        graph = stop_graph(self.network)
        for stop_id in self.network.stop_ids():
            with self.subTest(stop=stop_id):
                self.assertEqual(graph[stop_id], neighbours(self.network, stop_id))


class ReachTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()

    def test_one_hop_is_the_neighbours(self):
        found = reachable_stops(self.network, "a", 1)
        self.assertEqual(set(found), set(neighbours(self.network, "a")))

    def test_two_hops_reach_further(self):
        found = reachable_stops(self.network, "a", 2)
        self.assertIn("c", found)

    def test_the_depth_is_recorded(self):
        found = reachable_stops(self.network, "a")
        self.assertEqual(found["b"], 1)
        self.assertEqual(found["c"], 2)

    def test_the_start_is_left_out(self):
        self.assertNotIn("a", reachable_stops(self.network, "a"))

    def test_everything_is_reachable_from_the_west_end(self):
        self.assertEqual(len(reachable_stops(self.network, "a")), 4)

    def test_a_negative_limit_raises(self):
        with self.assertRaises(NetworkError):
            reachable_stops(self.network, "a", -1)

    def test_a_limit_of_nothing_reaches_nothing(self):
        self.assertEqual(reachable_stops(self.network, "a", 0), {})

    def test_hops_between_two_stops(self):
        self.assertEqual(hops_between(self.network, "a", "d"), 3)

    def test_no_hops_to_itself(self):
        self.assertEqual(hops_between(self.network, "a", "a"), 0)

    def test_nothing_between_unconnected_stops(self):
        self.assertIsNone(hops_between(self.network, "p", "a"))


class ComponentTest(unittest.TestCase):
    def test_one_network_is_one_component(self):
        self.assertEqual(len(components(line_network())), 1)

    def test_a_split_feed_has_two(self):
        self.assertEqual(len(components(split_network())), 2)

    def test_the_biggest_component_comes_first(self):
        network = split_network()
        builder = NetworkBuilder.from_network(network)
        builder.stop("c", "C", "52.5", "13.4")
        builder.pattern("first-long", "first", ["a", "b", "c"])
        builder.trip("f2", "first-long", "weekday", ["09:00", "09:10", "09:20"])
        groups = components(builder.build())
        self.assertEqual(groups[0], ("a", "b", "c"))

    def test_a_component_lists_its_stops(self):
        self.assertEqual(components(split_network())[1], ("y", "z"))

    def test_one_network_is_connected(self):
        self.assertTrue(is_connected(line_network()))

    def test_a_split_feed_is_not(self):
        self.assertFalse(is_connected(split_network()))

    def test_a_transfer_joins_two_halves(self):
        self.assertTrue(is_connected(transfer_network()))

    def test_without_walking_the_two_halves_do_not_meet(self):
        self.assertIsNone(hops_between(transfer_network(), "x", "y", walking=False))

    def test_with_walking_they_do(self):
        self.assertEqual(hops_between(transfer_network(), "x", "y"), 1)


class RouteNeighbourTest(unittest.TestCase):
    def test_two_routes_that_cross_are_neighbours(self):
        self.assertEqual(route_neighbours(line_network(), "x"), ("y",))

    def test_the_other_way_round_too(self):
        self.assertEqual(route_neighbours(line_network(), "y"), ("x",))

    def test_a_route_is_not_its_own_neighbour(self):
        self.assertNotIn("x", route_neighbours(line_network(), "x"))

    def test_an_unknown_route_raises(self):
        with self.assertRaises(NetworkError):
            route_neighbours(line_network(), "z")

    def test_a_route_on_its_own_has_no_neighbours(self):
        self.assertEqual(route_neighbours(split_network(), "first"), ())


if __name__ == "__main__":
    unittest.main()
