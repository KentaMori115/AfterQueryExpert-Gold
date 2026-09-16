"""The fare table and how it picks a product."""

import unittest

from layover.errors import FareError
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.money import Money


def table():
    return FareTable(
        [
            FareProduct("short", Money("1.90"), transfers=0),
            FareProduct("single", Money("2.40"), transfers=1, window=3600),
            FareProduct("tram", Money("2.10"), transfers=1),
        ],
        [
            FareRule("single"),
            FareRule("short", "A", "A"),
            FareRule("tram", "A", "B", "x"),
        ],
    )


class HoldingTest(unittest.TestCase):
    def setUp(self):
        self.table = table()

    def test_counts_its_products(self):
        self.assertEqual(len(self.table), 3)

    def test_products_come_back_sorted(self):
        self.assertEqual([p.fare_id for p in self.table.products()], ["short", "single", "tram"])

    def test_rules_keep_their_order(self):
        self.assertEqual([r.fare_id for r in self.table.rules()], ["single", "short", "tram"])

    def test_finds_a_product(self):
        self.assertEqual(self.table.product("single").price, Money("2.40"))

    def test_an_unknown_product_raises(self):
        with self.assertRaises(FareError):
            self.table.product("nope")

    def test_rejects_a_repeated_product(self):
        with self.assertRaises(FareError):
            self.table.add_product(FareProduct("single", Money("3")))

    def test_rejects_a_rule_for_an_unknown_product(self):
        with self.assertRaises(FareError):
            self.table.add_rule(FareRule("nope"))

    def test_rejects_a_product_in_another_currency(self):
        with self.assertRaises(FareError):
            self.table.add_product(FareProduct("gbp", Money("2", "GBP")))

    def test_an_empty_table_prices_nothing(self):
        self.assertTrue(FareTable().is_empty)

    def test_a_table_with_no_rules_prices_nothing(self):
        self.assertTrue(FareTable([FareProduct("s", Money("1"))]).is_empty)

    def test_a_full_table_is_not_empty(self):
        self.assertFalse(self.table.is_empty)

    def test_renders_its_counts(self):
        self.assertEqual(str(self.table), "3 fares, 3 rules")


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.table = table()

    def test_the_most_specific_rule_wins(self):
        self.assertEqual(self.table.match("A", "B", "x").fare_id, "tram")

    def test_a_two_zone_rule_beats_the_catch_all(self):
        self.assertEqual(self.table.match("A", "A", "y").fare_id, "short")

    def test_the_catch_all_covers_the_rest(self):
        self.assertEqual(self.table.match("C", "D", "z").fare_id, "single")

    def test_the_route_rule_only_applies_to_that_route(self):
        self.assertEqual(self.table.match("A", "B", "y").fare_id, "single")

    def test_price_of_a_ride(self):
        self.assertEqual(self.table.price_of("A", "A", "y"), Money("1.90"))

    def test_price_raises_when_nothing_matches(self):
        bare = FareTable([FareProduct("s", Money("1"))], [FareRule("s", "A", "A")])
        with self.assertRaises(FareError):
            bare.price_of("A", "B", "x")

    def test_match_returns_nothing_when_nothing_fits(self):
        bare = FareTable([FareProduct("s", Money("1"))], [FareRule("s", "A", "A")])
        self.assertIsNone(bare.match("A", "B", "x"))

    def test_a_tie_goes_to_the_cheaper_product(self):
        tied = FareTable(
            [FareProduct("dear", Money("3")), FareProduct("cheap", Money("2"))],
            [FareRule("dear", "A", "B"), FareRule("cheap", "A", "B")],
        )
        self.assertEqual(tied.match("A", "B", "x").fare_id, "cheap")

    def test_the_order_rules_were_added_does_not_matter(self):
        first = FareTable(
            [FareProduct("a", Money("2")), FareProduct("b", Money("3"))],
            [FareRule("a"), FareRule("b", "A", "B")],
        )
        second = FareTable(
            [FareProduct("a", Money("2")), FareProduct("b", Money("3"))],
            [FareRule("b", "A", "B"), FareRule("a")],
        )
        self.assertEqual(first.match("A", "B", "x").fare_id, second.match("A", "B", "x").fare_id)

    def test_ordered_rules_put_the_specific_first(self):
        ordered = self.table.ordered_rules()
        self.assertEqual(ordered[0].fare_id, "tram")
        self.assertEqual(ordered[-1].fare_id, "single")

    def test_adding_a_rule_reorders(self):
        self.table.add_rule(FareRule("short", "C", "C"))
        self.assertEqual(self.table.match("C", "C", "z").fare_id, "short")


class SummaryTest(unittest.TestCase):
    def setUp(self):
        self.table = table()

    def test_the_cheapest_product(self):
        self.assertEqual(self.table.cheapest().fare_id, "short")

    def test_the_dearest_product(self):
        self.assertEqual(self.table.dearest().fare_id, "single")

    def test_an_empty_table_has_no_cheapest(self):
        self.assertIsNone(FareTable().cheapest())
        self.assertIsNone(FareTable().dearest())

    def test_no_product_is_unused_here(self):
        self.assertEqual(self.table.unused_products(), ())

    def test_an_unused_product_is_reported(self):
        self.table.add_product(FareProduct("day", Money("9")))
        self.assertEqual(self.table.unused_products(), ("day",))

    def test_zones_named_by_the_rules(self):
        self.assertEqual(self.table.zones_named(), ("A", "B"))

    def test_a_flat_table_prices_everything(self):
        flat = FareTable.flat(Money("2.00"))
        self.assertEqual(flat.price_of("Z", "Q", "anything"), Money("2.00"))

    def test_a_flat_table_has_one_product(self):
        self.assertEqual(len(FareTable.flat("2.00")), 1)

    def test_a_flat_table_can_limit_changes(self):
        flat = FareTable.flat("2.00", transfers=0)
        self.assertEqual(flat.product("flat").transfers, 0)


if __name__ == "__main__":
    unittest.main()
