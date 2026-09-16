"""Fare amounts held as decimals under a fixed currency."""

import unittest
from decimal import Decimal

from layover.errors import FareError, Location
from layover.money import CENT, Money, parse_amount, total_of


class ParseAmountTest(unittest.TestCase):
    def test_reads_a_string(self):
        self.assertEqual(parse_amount("2.40"), Decimal("2.40"))

    def test_reads_an_integer(self):
        self.assertEqual(parse_amount(3), Decimal("3.00"))

    def test_reads_a_decimal(self):
        self.assertEqual(parse_amount(Decimal("1.5")), Decimal("1.50"))

    def test_quantises_to_the_cent(self):
        self.assertEqual(parse_amount("2.4"), Decimal("2.40"))

    def test_rounds_a_half_cent_up(self):
        self.assertEqual(parse_amount("2.405"), Decimal("2.41"))

    def test_rounds_below_a_half_cent_down(self):
        self.assertEqual(parse_amount("2.404"), Decimal("2.40"))

    def test_rejects_a_float(self):
        with self.assertRaises(FareError):
            parse_amount(2.4)

    def test_rejects_empty(self):
        with self.assertRaises(FareError):
            parse_amount("   ")

    def test_rejects_letters(self):
        with self.assertRaises(FareError):
            parse_amount("free")

    def test_rejects_infinity(self):
        with self.assertRaises(FareError):
            parse_amount("Infinity")

    def test_rejects_a_list(self):
        with self.assertRaises(FareError):
            parse_amount(["2.40"])

    def test_carries_the_place(self):
        where = Location("fares", 2, "price")
        with self.assertRaises(FareError) as caught:
            parse_amount("nope", where)
        self.assertIs(caught.exception.where, where)

    def test_the_cent_constant(self):
        self.assertEqual(CENT, Decimal("0.01"))


class MoneyTest(unittest.TestCase):
    def setUp(self):
        self.fare = Money("2.40")

    def test_defaults_to_euros(self):
        self.assertEqual(self.fare.currency, "EUR")

    def test_upper_cases_the_currency(self):
        self.assertEqual(Money("1", "gbp").currency, "GBP")

    def test_rejects_a_two_letter_currency(self):
        with self.assertRaises(FareError):
            Money("1", "EU")

    def test_rejects_a_numeric_currency(self):
        with self.assertRaises(FareError):
            Money("1", "978")

    def test_renders_amount_and_currency(self):
        self.assertEqual(str(self.fare), "2.40 EUR")

    def test_parses_what_it_renders(self):
        self.assertEqual(Money.parse(str(self.fare)), self.fare)

    def test_parses_a_bare_amount(self):
        self.assertEqual(Money.parse("2.40"), self.fare)

    def test_parse_rejects_three_words(self):
        with self.assertRaises(FareError):
            Money.parse("2.40 EUR each")

    def test_adds(self):
        self.assertEqual(self.fare + Money("0.60"), Money("3.00"))

    def test_subtracts(self):
        self.assertEqual(self.fare - Money("0.40"), Money("2.00"))

    def test_can_go_negative(self):
        self.assertEqual(Money("1") - Money("3"), Money("-2"))

    def test_multiplies_by_a_count(self):
        self.assertEqual(self.fare * 3, Money("7.20"))

    def test_negates(self):
        self.assertEqual(-self.fare, Money("-2.40"))

    def test_refuses_to_multiply_by_a_decimal(self):
        with self.assertRaises(FareError):
            self.fare * Decimal("2")

    def test_refuses_to_multiply_by_a_bool(self):
        with self.assertRaises(FareError):
            self.fare * True

    def test_refuses_to_add_another_currency(self):
        with self.assertRaises(FareError):
            self.fare + Money("1", "GBP")

    def test_refuses_to_add_a_number(self):
        with self.assertRaises(FareError):
            self.fare + 1

    def test_refuses_to_compare_across_currencies(self):
        with self.assertRaises(FareError):
            self.fare < Money("1", "GBP")

    def test_three_additions_stay_exact(self):
        total = Money("0.10") + Money("0.20") + Money("0.30")
        self.assertEqual(total, Money("0.60"))

    def test_cents_are_whole(self):
        self.assertEqual(self.fare.cents, 240)

    def test_zero_knows_it(self):
        self.assertTrue(Money.zero().is_zero)

    def test_a_fare_is_not_zero(self):
        self.assertFalse(self.fare.is_zero)

    def test_zero_takes_a_currency(self):
        self.assertEqual(Money.zero("chf").currency, "CHF")

    def test_orders_by_amount(self):
        self.assertLess(Money("1.00"), Money("2.00"))

    def test_sorts(self):
        prices = sorted([Money("3"), Money("1.50"), Money("2")])
        self.assertEqual(prices[0], Money("1.50"))

    def test_greater_or_equal_on_a_tie(self):
        self.assertGreaterEqual(self.fare, Money("2.40"))

    def test_less_or_equal_on_a_tie(self):
        self.assertLessEqual(self.fare, Money("2.40"))

    def test_is_hashable(self):
        self.assertEqual(len({Money("1"), Money("1.00")}), 1)

    def test_a_cap_below_the_fare_wins(self):
        self.assertEqual(self.fare.capped_at(Money("2.00")), Money("2.00"))

    def test_a_cap_above_the_fare_does_nothing(self):
        self.assertEqual(self.fare.capped_at(Money("5.00")), self.fare)

    def test_a_cap_in_another_currency_raises(self):
        with self.assertRaises(FareError):
            self.fare.capped_at(Money("2", "GBP"))

    def test_shares_evenly(self):
        self.assertEqual(Money("3.00").share(3), (Money("1.00"),) * 3)

    def test_shares_a_remainder_to_the_front(self):
        parts = Money("1.00").share(3)
        self.assertEqual(parts, (Money("0.34"), Money("0.33"), Money("0.33")))

    def test_a_share_adds_back_to_the_whole(self):
        for parts in range(1, 8):
            with self.subTest(parts=parts):
                self.assertEqual(total_of(Money("10.01").share(parts)), Money("10.01"))

    def test_share_rejects_zero_parts(self):
        with self.assertRaises(FareError):
            self.fare.share(0)

    def test_share_rejects_a_decimal_count(self):
        with self.assertRaises(FareError):
            self.fare.share(Decimal("2"))


class TotalTest(unittest.TestCase):
    def test_adds_a_list(self):
        self.assertEqual(total_of([Money("1"), Money("2"), Money("3")]), Money("6"))

    def test_nothing_totals_to_zero(self):
        self.assertEqual(total_of([]), Money.zero())

    def test_nothing_takes_the_currency_given(self):
        self.assertEqual(total_of([], "gbp"), Money.zero("GBP"))

    def test_refuses_a_mixed_list(self):
        with self.assertRaises(FareError):
            total_of([Money("1"), Money("1", "GBP")])


if __name__ == "__main__":
    unittest.main()
