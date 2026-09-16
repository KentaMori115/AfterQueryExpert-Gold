"""Properties that have to hold over the whole demo network.

These are not examples. Each one walks everything there is and asserts a rule
that the engine relies on elsewhere: that a board entry really is a call of a
real trip, that a planned journey could actually be caught, that the indexes
agree with the things they index.
"""

import unittest

from layover.demo import DEMO_DATE, DEMO_SATURDAY, DEMO_SUNDAY, demo_contents, demo_timetable
from layover.document import document_digest, from_document, to_document
from layover.feed import RawFeed, feed_to_text, load_feed
from layover.session import Session
from layover.times import SECONDS_PER_DAY, parse_clock
from layover.validate import validate

DATES = (DEMO_DATE, DEMO_SATURDAY, DEMO_SUNDAY)


class TripInvariantTest(unittest.TestCase):
    def setUp(self):
        self.network = demo_contents().network

    def test_a_trip_never_leaves_before_it_arrives(self):
        for trip in self.network.trips():
            for index in range(len(trip)):
                with self.subTest(trip=trip.trip_id, index=index):
                    self.assertGreaterEqual(trip.departures[index], trip.arrivals[index])

    def test_a_trip_never_goes_backwards(self):
        for trip in self.network.trips():
            times = []
            for index in range(len(trip)):
                times.extend([trip.arrivals[index], trip.departures[index]])
            with self.subTest(trip=trip.trip_id):
                self.assertEqual(times, sorted(times))

    def test_a_trip_has_a_time_for_every_stop_of_its_pattern(self):
        for trip in self.network.trips():
            with self.subTest(trip=trip.trip_id):
                self.assertEqual(len(trip), len(self.network.pattern(trip.pattern_id)))

    def test_no_trip_runs_longer_than_a_day(self):
        for trip in self.network.trips():
            with self.subTest(trip=trip.trip_id):
                self.assertLess(trip.duration, SECONDS_PER_DAY)

    def test_every_trip_names_a_service_that_exists(self):
        known = set(demo_contents().services.ids())
        for trip in self.network.trips():
            with self.subTest(trip=trip.trip_id):
                self.assertIn(trip.service_id, known)


class IndexInvariantTest(unittest.TestCase):
    def setUp(self):
        self.network = demo_contents().network

    def test_patterns_at_a_stop_really_call_there(self):
        for stop in self.network.stops():
            for pattern_id, index in self.network.patterns_at(stop.stop_id):
                with self.subTest(stop=stop.stop_id, pattern=pattern_id):
                    self.assertEqual(self.network.pattern(pattern_id).stops[index], stop.stop_id)

    def test_every_call_of_every_pattern_is_indexed(self):
        for pattern in self.network.patterns():
            for index, stop_id in enumerate(pattern.stops):
                with self.subTest(pattern=pattern.pattern_id, index=index):
                    self.assertIn(
                        (pattern.pattern_id, index), self.network.patterns_at(stop_id)
                    )

    def test_trips_of_a_pattern_all_run_it(self):
        for pattern in self.network.patterns():
            for trip in self.network.trips_of_pattern(pattern.pattern_id):
                with self.subTest(pattern=pattern.pattern_id, trip=trip.trip_id):
                    self.assertEqual(trip.pattern_id, pattern.pattern_id)

    def test_every_trip_appears_under_its_pattern(self):
        for trip in self.network.trips():
            with self.subTest(trip=trip.trip_id):
                self.assertIn(trip, self.network.trips_of_pattern(trip.pattern_id))

    def test_routes_at_a_stop_are_the_routes_of_its_patterns(self):
        for stop in self.network.stops():
            expected = {
                self.network.pattern(pattern_id).route_id
                for pattern_id, _ in self.network.patterns_at(stop.stop_id)
            }
            with self.subTest(stop=stop.stop_id):
                self.assertEqual(set(self.network.routes_at(stop.stop_id)), expected)

    def test_children_and_parents_agree(self):
        for stop in self.network.stops():
            for child in self.network.children_of(stop.stop_id):
                with self.subTest(stop=stop.stop_id, child=child):
                    self.assertEqual(self.network.station_of(child), stop.stop_id)

    def test_every_transfer_is_reachable_from_its_origin(self):
        for transfer in self.network.transfers():
            with self.subTest(transfer=str(transfer)):
                self.assertIn(transfer, self.network.transfers_from(transfer.from_stop))


class BoardInvariantTest(unittest.TestCase):
    def setUp(self):
        self.timetable = demo_timetable()

    def test_a_board_entry_is_a_real_call(self):
        for stop in self.timetable.network.stops():
            for entry in self.timetable.calls_at(stop.stop_id, DEMO_DATE):
                with self.subTest(stop=stop.stop_id, trip=entry.trip_id):
                    self.assertEqual(entry.pattern.stops[entry.index], stop.stop_id)
                    self.assertEqual(
                        entry.service_departure, entry.trip.departure_at(entry.index)
                    )

    def test_every_departure_allows_boarding(self):
        for stop in self.timetable.network.stops():
            for entry in self.timetable.departures(stop.stop_id, DEMO_DATE, limit=None):
                with self.subTest(stop=stop.stop_id, trip=entry.trip_id):
                    self.assertTrue(entry.can_board)

    def test_every_arrival_allows_alighting(self):
        for stop in self.timetable.network.stops():
            for entry in self.timetable.arrivals(stop.stop_id, DEMO_DATE, limit=None):
                with self.subTest(stop=stop.stop_id, trip=entry.trip_id):
                    self.assertTrue(entry.can_alight)

    def test_a_board_is_in_time_order(self):
        for stop in self.timetable.network.stops():
            times = [
                entry.departure
                for entry in self.timetable.departures(stop.stop_id, DEMO_DATE, limit=None)
            ]
            with self.subTest(stop=stop.stop_id):
                self.assertEqual(times, sorted(times))

    def test_the_trips_running_are_the_trips_whose_service_runs(self):
        for day in DATES:
            running = set(self.timetable.services_on(day))
            expected = {
                trip.trip_id
                for trip in self.timetable.network.trips()
                if trip.service_id in running
            }
            with self.subTest(day=day):
                self.assertEqual(
                    {trip.trip_id for trip in self.timetable.running_trips(day)}, expected
                )

    def test_the_trip_count_matches_the_trips(self):
        for day in DATES:
            with self.subTest(day=day):
                self.assertEqual(
                    self.timetable.trip_count(day), len(self.timetable.running_trips(day))
                )


class JourneyInvariantTest(unittest.TestCase):
    def setUp(self):
        self.session = Session.demo()
        self.pairs = (
            ("westtor", "ostfeld"),
            ("westtor", "hafen"),
            ("nordpark", "strandbad"),
            ("rathaus", "flughafen"),
            ("marktplatz", "inselsteg"),
        )

    def journeys(self, at="09:00"):
        for origin, destination in self.pairs:
            for journey in self.session.plan(origin, destination, DEMO_DATE, parse_clock(at)):
                yield origin, destination, journey

    def test_a_journey_starts_and_ends_where_it_was_asked_to(self):
        for origin, destination, journey in self.journeys():
            with self.subTest(origin=origin, destination=destination):
                self.assertEqual(journey.origin, origin)
                self.assertEqual(journey.destination, destination)

    def test_every_ride_is_a_real_trip_calling_at_both_stops(self):
        network = self.session.network
        for _origin, _destination, journey in self.journeys():
            for leg in journey.rides:
                trip = network.trip(leg.trip_id)
                pattern = network.pattern(trip.pattern_id)
                with self.subTest(trip=leg.trip_id):
                    self.assertIn(leg.from_stop, pattern.stops)
                    self.assertIn(leg.to_stop, pattern.stops)
                    self.assertLess(
                        pattern.stops.index(leg.from_stop), pattern.stops.index(leg.to_stop)
                    )

    def test_every_ride_matches_the_timetable(self):
        network = self.session.network
        for _origin, _destination, journey in self.journeys():
            for leg in journey.rides:
                trip = network.trip(leg.trip_id)
                pattern = network.pattern(trip.pattern_id)
                board = pattern.stops.index(leg.from_stop)
                alight = pattern.stops.index(leg.to_stop)
                with self.subTest(trip=leg.trip_id):
                    self.assertEqual(leg.departure % 86400, trip.departure_at(board) % 86400)
                    self.assertEqual(leg.arrival % 86400, trip.arrival_at(alight) % 86400)

    def test_every_walk_is_a_declared_transfer(self):
        network = self.session.network
        for _origin, _destination, journey in self.journeys():
            for leg in journey.walks:
                with self.subTest(walk=str(leg)):
                    self.assertEqual(
                        network.transfer_time(leg.from_stop, leg.to_stop), leg.duration
                    )

    def test_a_journey_is_never_longer_than_the_sum_of_its_parts(self):
        for _origin, _destination, journey in self.journeys():
            with self.subTest(journey=str(journey)):
                self.assertEqual(
                    journey.duration,
                    journey.ride_seconds + journey.walk_seconds + journey.wait_seconds,
                )

    def test_no_journey_is_dominated_by_another_offered_beside_it(self):
        for origin, destination in self.pairs:
            journeys = self.session.plan(origin, destination, DEMO_DATE, parse_clock("09:00"))
            for first in journeys:
                for second in journeys:
                    if first is second:
                        continue
                    with self.subTest(origin=origin, destination=destination):
                        self.assertFalse(first.dominates(second))

    def test_the_earliest_arrival_matches_the_best_journey(self):
        for origin, destination in self.pairs:
            journeys = self.session.plan(origin, destination, DEMO_DATE, parse_clock("09:00"))
            reachable = self.session.reachable(origin, DEMO_DATE, parse_clock("09:00"))
            with self.subTest(origin=origin, destination=destination):
                self.assertEqual(min(journey.arrival for journey in journeys), reachable[destination])

    def test_every_reachable_stop_can_be_planned_to(self):
        reachable = self.session.reachable("westtor", DEMO_DATE, parse_clock("09:00"))
        for stop_id, arrival in sorted(reachable.items()):
            with self.subTest(stop=stop_id):
                journeys = self.session.plan("westtor", stop_id, DEMO_DATE, parse_clock("09:00"))
                self.assertTrue(journeys)
                self.assertLessEqual(min(journey.arrival for journey in journeys), arrival)


class FareInvariantTest(unittest.TestCase):
    def setUp(self):
        self.session = Session.demo()

    def test_the_total_is_the_sum_of_the_tickets(self):
        for destination in ("ostfeld", "hafen", "flughafen", "strandbad"):
            journeys = self.session.plan("westtor", destination, DEMO_DATE, parse_clock("09:00"))
            for journey in journeys:
                price = self.session.price(journey)
                with self.subTest(destination=destination):
                    total = price.tickets[0].price
                    for ticket in price.tickets[1:]:
                        total = total + ticket.price
                    self.assertEqual(price.total, total)

    def test_every_ride_is_priced_exactly_once(self):
        for destination in ("ostfeld", "hafen", "flughafen"):
            journeys = self.session.plan("westtor", destination, DEMO_DATE, parse_clock("09:00"))
            for journey in journeys:
                price = self.session.price(journey)
                with self.subTest(destination=destination):
                    self.assertEqual(len(price.rides), len(journey.rides))

    def test_a_fare_is_never_negative(self):
        journeys = self.session.plan("westtor", "strandbad", DEMO_DATE, parse_clock("09:00"))
        for journey in journeys:
            with self.subTest(journey=str(journey)):
                self.assertGreater(self.session.price(journey).total.cents, 0)


class WholeFeedTest(unittest.TestCase):
    def test_the_demo_passes_every_check(self):
        self.assertTrue(validate(demo_contents()).clean)

    def test_the_feed_round_trips_through_tables(self):
        again = load_feed(RawFeed.of_text(feed_to_text(demo_contents())), "Marnstadt")
        self.assertEqual(document_digest(again), document_digest(demo_contents()))

    def test_the_feed_round_trips_through_a_document(self):
        again = from_document(to_document(demo_contents()))
        self.assertEqual(document_digest(again), document_digest(demo_contents()))

    def test_a_round_tripped_feed_plans_the_same_journey(self):
        again = from_document(to_document(demo_contents()))
        first = Session(demo_contents()).plan("westtor", "hafen", DEMO_DATE, parse_clock("09:00"))
        second = Session(again).plan("westtor", "hafen", DEMO_DATE, parse_clock("09:00"))
        self.assertEqual([str(journey) for journey in first], [str(journey) for journey in second])


if __name__ == "__main__":
    unittest.main()
