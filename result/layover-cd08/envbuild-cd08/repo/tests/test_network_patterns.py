"""Stop patterns and where a passenger may get on and off."""

import unittest

from layover.errors import NetworkError
from layover.network.patterns import Pattern


class BuildTest(unittest.TestCase):
    def test_keeps_the_stops_in_order(self):
        pattern = Pattern("p", "r", ("a", "b", "c"))
        self.assertEqual(pattern.stops, ("a", "b", "c"))

    def test_counts_its_stops(self):
        self.assertEqual(len(Pattern("p", "r", ("a", "b", "c"))), 3)

    def test_trims_stop_identifiers(self):
        self.assertEqual(Pattern("p", "r", (" a ", "b")).stops, ("a", "b"))

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(NetworkError):
            Pattern("  ", "r", ("a", "b"))

    def test_rejects_a_missing_route(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "  ", ("a", "b"))

    def test_rejects_a_single_stop(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a",))

    def test_rejects_an_empty_stop(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a", " "))

    def test_rejects_the_same_stop_twice_in_a_row(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a", "a", "b"))

    def test_allows_a_stop_again_later(self):
        self.assertEqual(len(Pattern("p", "r", ("a", "b", "a"))), 3)

    def test_defaults_to_boarding_everywhere(self):
        self.assertEqual(Pattern("p", "r", ("a", "b")).pickup, (True, True))

    def test_flags_must_match_the_stop_count(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a", "b", "c"), (True, True))

    def test_dropoff_flags_must_match_too(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a", "b"), (True, True), (True,))

    def test_rejects_a_direction_that_is_not_zero_or_one(self):
        with self.assertRaises(NetworkError):
            Pattern("p", "r", ("a", "b"), direction=2)

    def test_trims_the_headsign(self):
        self.assertEqual(Pattern("p", "r", ("a", "b"), headsign="  East ").headsign, "East")

    def test_is_hashable(self):
        self.assertEqual(len({Pattern("p", "r", ("a", "b")), Pattern("p", "r", ("a", "b"))}), 1)


class StraightPatternTest(unittest.TestCase):
    def setUp(self):
        self.pattern = Pattern.straight("p", "r", ["a", "b", "c", "d"], "East")

    def test_cannot_alight_at_the_first_stop(self):
        self.assertFalse(self.pattern.can_alight(0))

    def test_cannot_board_at_the_last_stop(self):
        self.assertFalse(self.pattern.can_board(3))

    def test_can_board_in_the_middle(self):
        self.assertTrue(self.pattern.can_board(1))

    def test_can_alight_in_the_middle(self):
        self.assertTrue(self.pattern.can_alight(2))

    def test_boardable_stops_leave_out_the_last(self):
        self.assertEqual(self.pattern.boardable_stops(), ("a", "b", "c"))

    def test_reachable_from_the_start(self):
        self.assertEqual(self.pattern.reachable_from(0), ((1, "b"), (2, "c"), (3, "d")))

    def test_reachable_from_the_middle(self):
        self.assertEqual(self.pattern.reachable_from(2), ((3, "d"),))

    def test_nothing_is_reachable_from_the_end(self):
        self.assertEqual(self.pattern.reachable_from(3), ())


class LookupTest(unittest.TestCase):
    def setUp(self):
        self.pattern = Pattern.straight("p", "r", ["a", "b", "c", "b", "e"])

    def test_origin_and_destination(self):
        self.assertEqual((self.pattern.origin, self.pattern.destination), ("a", "e"))

    def test_serves_a_stop_it_calls_at(self):
        self.assertTrue(self.pattern.serves("c"))

    def test_does_not_serve_a_stranger(self):
        self.assertFalse(self.pattern.serves("z"))

    def test_index_of_finds_the_first_call(self):
        self.assertEqual(self.pattern.index_of("b"), 1)

    def test_index_of_raises_for_a_stranger(self):
        with self.assertRaises(NetworkError):
            self.pattern.index_of("z")

    def test_indexes_of_finds_every_call(self):
        self.assertEqual(self.pattern.indexes_of("b"), (1, 3))

    def test_indexes_of_a_stranger_is_empty(self):
        self.assertEqual(self.pattern.indexes_of("z"), ())

    def test_a_segment_covers_both_ends(self):
        self.assertEqual(self.pattern.segment(1, 3), ("b", "c", "b"))

    def test_a_segment_of_one_stop(self):
        self.assertEqual(self.pattern.segment(2, 2), ("c",))

    def test_a_backwards_segment_raises(self):
        with self.assertRaises(NetworkError):
            self.pattern.segment(3, 1)

    def test_a_segment_past_the_end_raises(self):
        with self.assertRaises(NetworkError):
            self.pattern.segment(0, 9)

    def test_a_straight_pattern_is_not_a_loop(self):
        self.assertFalse(self.pattern.is_loop)

    def test_a_loop_knows_it(self):
        self.assertTrue(Pattern.straight("p", "r", ["a", "b", "a"]).is_loop)

    def test_same_stops_as_an_identical_pattern(self):
        other = Pattern.straight("q", "r", ["a", "b", "c", "b", "e"])
        self.assertTrue(self.pattern.same_stops_as(other))

    def test_not_the_same_as_the_reverse(self):
        other = Pattern.straight("q", "r", ["e", "b", "c", "b", "a"])
        self.assertFalse(self.pattern.same_stops_as(other))

    def test_describes_itself(self):
        self.assertEqual(self.pattern.describe(), "a to e (5 stops)")

    def test_renders_with_its_identifier(self):
        self.assertEqual(str(self.pattern), "p: a to e (5 stops)")


if __name__ == "__main__":
    unittest.main()
