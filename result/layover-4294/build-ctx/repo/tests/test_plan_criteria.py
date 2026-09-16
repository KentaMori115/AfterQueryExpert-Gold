"""The settings a journey search runs under."""

import unittest

from layover.errors import PlanError
from layover.plan.criteria import SearchOptions


class DefaultTest(unittest.TestCase):
    def setUp(self):
        self.options = SearchOptions()

    def test_allows_a_few_changes(self):
        self.assertEqual(self.options.max_transfers, 4)

    def test_rides_are_changes_plus_one(self):
        self.assertEqual(self.options.max_rides, 5)

    def test_no_buffer_by_default(self):
        self.assertEqual(self.options.min_transfer_seconds, 0)

    def test_every_mode_is_allowed(self):
        self.assertTrue(self.options.allows_mode("ferry"))

    def test_every_route_is_allowed(self):
        self.assertTrue(self.options.allows_route("x"))

    def test_a_short_walk_is_allowed(self):
        self.assertTrue(self.options.allows_walk(600))

    def test_a_long_walk_is_not(self):
        self.assertFalse(self.options.allows_walk(1200))

    def test_describes_itself(self):
        self.assertIn("up to 4 changes", self.options.describe())

    def test_renders_as_its_description(self):
        self.assertEqual(str(self.options), self.options.describe())

    def test_is_hashable(self):
        self.assertEqual(len({SearchOptions(), SearchOptions()}), 1)


class ValidationTest(unittest.TestCase):
    def test_rejects_negative_changes(self):
        with self.assertRaises(PlanError):
            SearchOptions(max_transfers=-1)

    def test_allows_no_changes_at_all(self):
        self.assertEqual(SearchOptions(max_transfers=0).max_rides, 1)

    def test_rejects_a_negative_buffer(self):
        with self.assertRaises(PlanError):
            SearchOptions(min_transfer_seconds=-1)

    def test_rejects_a_negative_walk_limit(self):
        with self.assertRaises(PlanError):
            SearchOptions(max_walk_seconds=-1)

    def test_rejects_asking_for_no_journeys(self):
        with self.assertRaises(PlanError):
            SearchOptions(max_journeys=0)

    def test_rejects_a_window_of_no_time(self):
        with self.assertRaises(PlanError):
            SearchOptions(search_window=0)

    def test_rejects_allowing_no_mode(self):
        with self.assertRaises(PlanError):
            SearchOptions(allowed_modes=frozenset())


class FilterTest(unittest.TestCase):
    def test_modes_are_lower_cased(self):
        options = SearchOptions(allowed_modes=frozenset(["TRAM"]))
        self.assertTrue(options.allows_mode("tram"))

    def test_a_mode_outside_the_set_is_refused(self):
        options = SearchOptions(allowed_modes=frozenset(["tram"]))
        self.assertFalse(options.allows_mode("bus"))

    def test_a_banned_route_is_refused(self):
        options = SearchOptions(banned_routes=frozenset(["x"]))
        self.assertFalse(options.allows_route("x"))

    def test_other_routes_are_still_allowed(self):
        options = SearchOptions(banned_routes=frozenset(["x"]))
        self.assertTrue(options.allows_route("y"))

    def test_no_walk_limit_allows_anything(self):
        self.assertTrue(SearchOptions(max_walk_seconds=None).allows_walk(9999))

    def test_a_walk_exactly_on_the_limit_is_allowed(self):
        self.assertTrue(SearchOptions(max_walk_seconds=600).allows_walk(600))


class ChangedTest(unittest.TestCase):
    def setUp(self):
        self.options = SearchOptions()

    def test_changing_the_transfer_limit(self):
        self.assertEqual(self.options.with_transfers(1).max_transfers, 1)

    def test_changing_the_transfer_limit_keeps_the_rest(self):
        changed = self.options.with_transfers(1)
        self.assertEqual(changed.search_window, self.options.search_window)

    def test_restricting_the_modes(self):
        self.assertEqual(self.options.with_modes(["bus"]).allowed_modes, frozenset(["bus"]))

    def test_lifting_the_mode_restriction(self):
        restricted = self.options.with_modes(["bus"])
        self.assertIsNone(restricted.with_modes(None).allowed_modes)

    def test_banning_routes(self):
        self.assertIn("x", self.options.without_routes(["x"]).banned_routes)

    def test_changing_the_window(self):
        self.assertEqual(self.options.with_window(60).search_window, 60)

    def test_the_original_is_untouched(self):
        self.options.with_transfers(0)
        self.assertEqual(self.options.max_transfers, 4)

    def test_the_description_mentions_a_buffer(self):
        options = SearchOptions(min_transfer_seconds=120)
        self.assertIn("buffer 2m", options.describe())

    def test_the_description_mentions_banned_routes(self):
        self.assertIn("not x", self.options.without_routes(["x"]).describe())

    def test_the_description_mentions_modes(self):
        self.assertIn("modes bus", self.options.with_modes(["bus"]).describe())


if __name__ == "__main__":
    unittest.main()
