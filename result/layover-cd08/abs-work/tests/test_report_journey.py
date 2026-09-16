"""Itineraries and lists of journey options."""

import unittest

from layover.fares import FareTable, ZoneMap, price_rides
from layover.fares.price import Ride
from layover.plan import plan_journeys
from layover.report.journey import itinerary_report, journeys_report
from layover.timetable import Timetable
from layover.times import parse_clock
from tests.support import MONDAY, line_network, services, transfer_network


def timetable(network=None):
    return Timetable(network or line_network(), services())


def journeys(network=None, origin="a", destination="p"):
    return plan_journeys(timetable(network), origin, destination, MONDAY, parse_clock("07:30"))


class ItineraryTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()
        self.journey = journeys()[0]
        self.report = itinerary_report(self.journey, self.network)

    def test_the_title_names_both_ends(self):
        self.assertEqual(self.report.title, "Stop A to Stop P, 08:00")

    def test_a_row_per_leg(self):
        self.assertEqual(len(self.report), 2)

    def test_the_service_column_names_the_route(self):
        self.assertEqual(self.report.rows[0][1], "X")

    def test_the_stops_are_named(self):
        self.assertEqual(self.report.rows[0][3], "Stop A")

    def test_the_arrival_is_noted(self):
        self.assertIn("Arrives 08:14 after 14m.", self.report.notes)

    def test_the_changes_are_noted(self):
        self.assertIn("1 changes, 0m walking.", self.report.notes)

    def test_a_wait_becomes_its_own_row(self):
        report = itinerary_report(journeys(transfer_network(), "p", "s")[0], transfer_network())
        self.assertIn("wait", [row[1] for row in report.rows])

    def test_a_walk_is_labelled(self):
        report = itinerary_report(journeys(transfer_network(), "p", "s")[0], transfer_network())
        self.assertIn("walk", [row[1] for row in report.rows])

    def test_it_works_without_a_network(self):
        report = itinerary_report(self.journey)
        self.assertEqual(report.rows[0][3], "a")

    def test_a_fare_is_noted_when_given(self):
        rides = [
            Ride(leg.route_id, leg.from_stop, leg.to_stop, leg.departure, leg.arrival)
            for leg in self.journey.rides
        ]
        price = price_rides(rides, FareTable.flat("2.40"), ZoneMap.of_network(self.network))
        report = itinerary_report(self.journey, self.network, price)
        self.assertTrue(any(note.startswith("Fare ") for note in report.notes))


class JourneysReportTest(unittest.TestCase):
    def setUp(self):
        self.report = journeys_report(journeys(), line_network())

    def test_a_row_per_journey(self):
        self.assertEqual(len(self.report), 1)

    def test_the_columns_are_named(self):
        self.assertEqual(self.report.headers, ("Leaves", "Arrives", "Takes", "Changes", "Using"))

    def test_the_routes_are_listed(self):
        self.assertEqual(self.report.rows[0][4], "X Y")

    def test_the_change_count_is_shown(self):
        self.assertEqual(self.report.rows[0][3], "1")

    def test_an_empty_list_says_so(self):
        self.assertIn("No journey was found.", journeys_report([]).notes)

    def test_two_options_give_two_rows(self):
        report = journeys_report(journeys(transfer_network(), "p", "s"), transfer_network())
        self.assertEqual(len(report), 2)


if __name__ == "__main__":
    unittest.main()
