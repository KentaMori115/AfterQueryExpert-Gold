"""Pricing a sequence of rides under a fare table."""

import unittest

from layover.errors import FareError
from layover.fares.price import FarePrice, Ride, price_rides
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.fares.zones import ZoneMap
from layover.money import Money
from layover.times import parse_clock


def zones():
    return ZoneMap({"a": "A", "b": "A", "c": "B", "d": "B"})


def table(**changes):
    settings = dict(transfers=1, window=3600)
    settings.update(changes)
    return FareTable(
        [
            FareProduct("inner", Money("1.90"), **settings),
            FareProduct("crossing", Money("2.40"), **settings),
        ],
        [
            FareRule("inner", "A", "A"),
            FareRule("inner", "B", "B"),
            FareRule("crossing", "A", "B"),
            FareRule("crossing", "B", "A"),
        ],
    )


def ride(route, start, end, at, until=None):
    board = parse_clock(at)
    alight = parse_clock(until) if until else board + 600
    return Ride(route, start, end, board, alight)


class RideTest(unittest.TestCase):
    def test_knows_its_duration(self):
        self.assertEqual(ride("x", "a", "b", "08:00", "08:12").duration, 720)

    def test_rejects_getting_off_before_getting_on(self):
        with self.assertRaises(FareError):
            Ride("x", "a", "b", 600, 300)

    def test_a_ride_of_no_length_is_allowed(self):
        self.assertEqual(Ride("x", "a", "b", 600, 600).duration, 0)

    def test_renders_readably(self):
        self.assertEqual(str(ride("x", "a", "b", "08:00")), "x a to b at 08:00:00")

    def test_is_hashable(self):
        self.assertEqual(len({ride("x", "a", "b", "08:00"), ride("x", "a", "b", "08:00")}), 1)


class PriceTest(unittest.TestCase):
    def setUp(self):
        self.table = table()
        self.zones = zones()

    def price(self, rides):
        return price_rides(rides, self.table, self.zones)

    def test_one_ride_buys_one_ticket(self):
        price = self.price([ride("x", "a", "b", "08:00")])
        self.assertEqual(price.total, Money("1.90"))

    def test_a_crossing_ride_costs_more(self):
        price = self.price([ride("x", "a", "c", "08:00")])
        self.assertEqual(price.total, Money("2.40"))

    def test_a_change_inside_the_allowance_is_free(self):
        price = self.price([ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15")])
        self.assertEqual(price.total, Money("1.90"))
        self.assertEqual(price.ticket_count, 1)

    def test_a_second_change_buys_another_ticket(self):
        price = self.price(
            [
                ride("x", "a", "b", "08:00"),
                ride("y", "b", "c", "08:15"),
                ride("z", "c", "d", "08:30"),
            ]
        )
        self.assertEqual(price.ticket_count, 2)

    def test_a_change_past_the_window_buys_another_ticket(self):
        price = self.price([ride("x", "a", "b", "08:00"), ride("y", "b", "c", "09:30")])
        self.assertEqual(price.ticket_count, 2)

    def test_a_change_exactly_on_the_window_is_covered(self):
        price = self.price([ride("x", "a", "b", "08:00"), ride("y", "b", "c", "09:00")])
        self.assertEqual(price.ticket_count, 1)

    def test_the_product_comes_from_the_first_ride(self):
        price = self.price([ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15")])
        self.assertEqual(price.tickets[0].product.fare_id, "inner")

    def test_a_ticket_knows_how_many_rides_it_covered(self):
        price = self.price([ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15")])
        self.assertEqual(price.tickets[0].transfers, 1)

    def test_every_ride_appears_once(self):
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15"), ride("z", "c", "d", "08:30")]
        self.assertEqual(len(self.price(rides).rides), 3)

    def test_the_rides_come_back_in_order(self):
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15"), ride("z", "c", "d", "08:30")]
        self.assertEqual(list(self.price(rides).rides), rides)

    def test_no_rides_cost_nothing(self):
        self.assertEqual(self.price([]).total, Money.zero())

    def test_no_rides_buy_no_tickets(self):
        self.assertEqual(self.price([]).ticket_count, 0)

    def test_an_unzoned_stop_raises(self):
        with self.assertRaises(FareError):
            self.price([ride("x", "a", "z", "08:00")])

    def test_an_uncovered_zone_pair_raises(self):
        bare = FareTable([FareProduct("inner", Money("1"))], [FareRule("inner", "A", "A")])
        with self.assertRaises(FareError):
            price_rides([ride("x", "a", "c", "08:00")], bare, self.zones)

    def test_an_empty_table_raises(self):
        with self.assertRaises(FareError):
            price_rides([ride("x", "a", "b", "08:00")], FareTable(), self.zones)

    def test_an_unlimited_product_covers_every_change(self):
        self.table = table(transfers=None, window=None)
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "10:00"), ride("z", "c", "d", "12:00")]
        self.assertEqual(self.price(rides).ticket_count, 1)

    def test_a_product_with_no_changes_buys_a_ticket_a_ride(self):
        self.table = table(transfers=0)
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "08:15")]
        self.assertEqual(self.price(rides).ticket_count, 2)

    def test_the_total_is_the_sum_of_the_tickets(self):
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "09:30")]
        price = self.price(rides)
        self.assertEqual(price.total, price.tickets[0].price + price.tickets[1].price)

    def test_describes_one_ticket(self):
        self.assertEqual(self.price([ride("x", "a", "b", "08:00")]).describe(), "1.90 EUR on one ticket")

    def test_describes_several_tickets(self):
        rides = [ride("x", "a", "b", "08:00"), ride("y", "b", "c", "09:30")]
        self.assertIn("on 2 tickets", self.price(rides).describe())

    def test_renders_the_description(self):
        price = self.price([ride("x", "a", "b", "08:00")])
        self.assertEqual(str(price), price.describe())

    def test_a_ticket_records_when_it_was_bought(self):
        price = self.price([ride("x", "a", "b", "08:15")])
        self.assertEqual(price.tickets[0].bought_at, parse_clock("08:15"))

    def test_a_ticket_renders_readably(self):
        price = self.price([ride("x", "a", "b", "08:00")])
        self.assertEqual(str(price.tickets[0]), "inner at 08:00:00 for 1 rides")

    def test_six_rides_are_charged_six_times_with_no_changes_allowed(self):
        self.table = table(transfers=0)
        rides = [ride("x", "a", "b", "0%d:00" % (8 + index)) for index in range(6)]
        self.assertEqual(self.price(rides).total, Money("11.40"))

    def test_a_price_with_no_tickets_is_empty(self):
        self.assertEqual(FarePrice(Money.zero(), ()).ticket_count, 0)


if __name__ == "__main__":
    unittest.main()
