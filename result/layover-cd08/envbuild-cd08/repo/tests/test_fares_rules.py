"""Fare products and the rules that select them."""

import unittest

from layover.errors import FareError
from layover.fares.rules import FareProduct, FareRule
from layover.money import Money


class ProductTest(unittest.TestCase):
    def setUp(self):
        self.product = FareProduct("single", Money("2.40"), transfers=1, window=3600, name="Single")

    def test_keeps_its_price(self):
        self.assertEqual(self.product.price, Money("2.40"))

    def test_reads_a_bare_price(self):
        self.assertEqual(FareProduct("s", "2.40").price, Money("2.40"))

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(FareError):
            FareProduct("  ", Money("1"))

    def test_rejects_negative_transfers(self):
        with self.assertRaises(FareError):
            FareProduct("s", Money("1"), transfers=-1)

    def test_rejects_a_window_of_no_time(self):
        with self.assertRaises(FareError):
            FareProduct("s", Money("1"), window=0)

    def test_no_transfer_limit_means_unlimited(self):
        self.assertTrue(FareProduct("s", Money("1")).unlimited_transfers)

    def test_a_limit_is_not_unlimited(self):
        self.assertFalse(self.product.unlimited_transfers)

    def test_the_first_change_is_covered(self):
        self.assertTrue(self.product.covers_transfer(0))

    def test_the_second_change_is_not(self):
        self.assertFalse(self.product.covers_transfer(1))

    def test_an_unlimited_product_covers_any_change(self):
        product = FareProduct("s", Money("1"))
        self.assertTrue(product.covers_transfer(9))

    def test_a_negative_change_count_raises(self):
        with self.assertRaises(FareError):
            self.product.covers_transfer(-1)

    def test_inside_the_window(self):
        self.assertTrue(self.product.covers_time(3600))

    def test_past_the_window(self):
        self.assertFalse(self.product.covers_time(3601))

    def test_no_window_never_expires(self):
        self.assertTrue(FareProduct("s", Money("1")).covers_time(99999))

    def test_describes_price_changes_and_window(self):
        self.assertEqual(self.product.describe(), "2.40 EUR, 1 change, within 1h")

    def test_describes_no_changes(self):
        product = FareProduct("s", Money("1"), transfers=0)
        self.assertEqual(product.describe(), "1.00 EUR, no changes")

    def test_describes_several_changes(self):
        product = FareProduct("s", Money("1"), transfers=3)
        self.assertIn("3 changes", product.describe())

    def test_describes_unlimited_changes(self):
        self.assertIn("any changes", FareProduct("s", Money("1")).describe())

    def test_renders_with_its_name(self):
        self.assertTrue(str(self.product).startswith("Single ("))

    def test_renders_with_its_identifier_when_unnamed(self):
        self.assertTrue(str(FareProduct("s", Money("1"))).startswith("s ("))

    def test_is_hashable(self):
        self.assertEqual(len({FareProduct("s", Money("1")), FareProduct("s", Money("1"))}), 1)


class RuleTest(unittest.TestCase):
    def test_a_rule_with_no_conditions_matches_anything(self):
        rule = FareRule("flat")
        self.assertTrue(rule.matches("A", "B", "x"))

    def test_specificity_of_a_bare_rule(self):
        self.assertEqual(FareRule("flat").specificity, 0)

    def test_specificity_counts_the_conditions(self):
        self.assertEqual(FareRule("f", "A", "B", "x").specificity, 3)

    def test_a_zone_pair_matches(self):
        self.assertTrue(FareRule("f", "A", "B").matches("A", "B", "x"))

    def test_a_zone_pair_misses_the_wrong_origin(self):
        self.assertFalse(FareRule("f", "A", "B").matches("B", "B", "x"))

    def test_a_zone_pair_misses_the_wrong_destination(self):
        self.assertFalse(FareRule("f", "A", "B").matches("A", "C", "x"))

    def test_a_route_condition_matches(self):
        self.assertTrue(FareRule("f", route_id="x").matches("A", "B", "x"))

    def test_a_route_condition_misses(self):
        self.assertFalse(FareRule("f", route_id="x").matches("A", "B", "y"))

    def test_an_origin_only_rule(self):
        self.assertTrue(FareRule("f", from_zone="A").matches("A", "Z", "q"))

    def test_rejects_an_empty_product(self):
        with self.assertRaises(FareError):
            FareRule("  ")

    def test_rejects_an_empty_zone(self):
        with self.assertRaises(FareError):
            FareRule("f", from_zone="  ")

    def test_trims_the_conditions(self):
        self.assertEqual(FareRule("f", " A ").from_zone, "A")

    def test_renders_a_zone_pair(self):
        self.assertEqual(str(FareRule("f", "A", "B")), "f: A to B")

    def test_renders_a_route_condition(self):
        self.assertIn("on x", str(FareRule("f", "A", "B", "x")))

    def test_renders_a_bare_rule(self):
        self.assertEqual(str(FareRule("f")), "f: anywhere")

    def test_renders_an_origin_only_rule(self):
        self.assertEqual(str(FareRule("f", from_zone="A")), "f: A to any")


if __name__ == "__main__":
    unittest.main()
