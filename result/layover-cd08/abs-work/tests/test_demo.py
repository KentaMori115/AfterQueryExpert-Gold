"""The worked example network and what can be asked of it."""

import os
import tempfile
import unittest

from layover.demo import (
    DEMO_DATE,
    DEMO_HOLIDAY,
    DEMO_SATURDAY,
    DEMO_SUNDAY,
    build_demo,
    demo_contents,
    demo_feed_text,
    demo_timetable,
    write_demo_feed,
)
from layover.document import document_digest, from_document, to_document
from layover.feed import RawFeed, load_feed, read_directory
from layover.plan import plan_journeys
from layover.times import parse_clock
from layover.validate import validate


class ShapeTest(unittest.TestCase):
    def setUp(self):
        self.contents = demo_contents()

    def test_it_has_the_stops(self):
        self.assertEqual(len(self.contents.network), 18)

    def test_it_has_six_routes(self):
        self.assertEqual(len(self.contents.network.routes()), 6)

    def test_it_has_twelve_patterns(self):
        self.assertEqual(len(self.contents.network.patterns()), 12)

    def test_it_has_a_thousand_trips_or_so(self):
        self.assertGreater(len(self.contents.network.trips()), 1000)

    def test_it_has_three_calendars(self):
        self.assertEqual(self.contents.services.ids(), ("saturday", "sunday", "weekday"))

    def test_it_has_fares(self):
        self.assertTrue(self.contents.has_fares)

    def test_the_station_holds_two_platforms(self):
        self.assertEqual(self.contents.network.children_of("hbf"), ("hbf-u1", "hbf-u2"))

    def test_the_platforms_are_a_short_walk_apart(self):
        self.assertEqual(self.contents.network.transfer_time("hbf-u1", "hbf-u2"), 150)

    def test_the_outer_zone_exists(self):
        self.assertEqual(self.contents.zones().zones(), ("A", "B"))

    def test_building_it_twice_gives_the_same_thing(self):
        self.assertEqual(document_digest(build_demo()), document_digest(self.contents))

    def test_the_shared_copy_is_shared(self):
        self.assertIs(demo_contents(), demo_contents())

    def test_it_passes_every_check(self):
        self.assertTrue(validate(self.contents).clean)


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.timetable = demo_timetable()

    def test_a_weekday_runs_the_weekday_service(self):
        self.assertEqual(self.timetable.services_on(DEMO_DATE), ("weekday",))

    def test_a_saturday_runs_its_own_service(self):
        self.assertEqual(self.timetable.services_on(DEMO_SATURDAY), ("saturday",))

    def test_a_sunday_runs_its_own_service(self):
        self.assertEqual(self.timetable.services_on(DEMO_SUNDAY), ("sunday",))

    def test_the_holiday_runs_the_sunday_service(self):
        self.assertEqual(self.timetable.services_on(DEMO_HOLIDAY), ("sunday",))

    def test_a_weekday_is_busier_than_a_sunday(self):
        self.assertGreater(
            self.timetable.trip_count(DEMO_DATE), self.timetable.trip_count(DEMO_SUNDAY)
        )

    def test_the_ferry_only_runs_in_the_middle_of_the_day(self):
        board = self.timetable.departures("hafen", DEMO_DATE, routes=["f1"])
        self.assertEqual(board[0].departure, parse_clock("09:00"))

    def test_nothing_runs_before_the_first_departure(self):
        self.assertEqual(self.timetable.departures("westtor", DEMO_DATE, after=parse_clock("04:00"), limit=1)[0].departure, parse_clock("05:40"))

    def test_every_stop_is_served_on_a_weekday(self):
        for stop in self.timetable.network.stops():
            if stop.is_station:
                continue
            with self.subTest(stop=stop.stop_id):
                self.assertTrue(self.timetable.serves(stop.stop_id, DEMO_DATE))


class JourneyTest(unittest.TestCase):
    def setUp(self):
        self.timetable = demo_timetable()

    def plan(self, origin, destination, at="08:00"):
        return plan_journeys(self.timetable, origin, destination, DEMO_DATE, parse_clock(at))

    def test_a_direct_journey_along_one_line(self):
        journeys = self.plan("westtor", "ostfeld")
        self.assertEqual(journeys[0].routes(), ("u1",))

    def test_a_journey_across_the_station(self):
        journeys = self.plan("westtor", "hafen")
        self.assertEqual(journeys[0].routes(), ("u1", "u2"))

    def test_that_journey_walks_between_the_platforms(self):
        journeys = self.plan("westtor", "hafen")
        self.assertTrue(journeys[0].walks)

    def test_a_journey_to_the_airport_needs_the_bus(self):
        journeys = self.plan("rathaus", "flughafen")
        self.assertIn("b10", journeys[0].routes())

    def test_a_journey_to_the_island_needs_the_ferry(self):
        journeys = self.plan("marktplatz", "inselsteg", "10:00")
        self.assertIn("f1", journeys[0].routes())

    def test_the_island_is_unreachable_before_the_ferry_starts(self):
        self.assertEqual(self.plan("marktplatz", "inselsteg", "06:00"), ())

    def test_a_journey_arrives_after_it_leaves(self):
        for journey in self.plan("westtor", "strandbad"):
            with self.subTest(journey=journey):
                self.assertGreater(journey.arrival, journey.departure)

    def test_a_sunday_journey_is_still_possible(self):
        journeys = plan_journeys(
            self.timetable, "westtor", "ostfeld", DEMO_SUNDAY, parse_clock("09:00")
        )
        self.assertTrue(journeys)


class ExportTest(unittest.TestCase):
    def test_the_feed_text_has_every_table(self):
        self.assertGreaterEqual(len(demo_feed_text()), 10)

    def test_the_feed_text_reads_back(self):
        contents = load_feed(RawFeed.of_text(demo_feed_text()), "Marnstadt")
        self.assertEqual(contents.counts(), demo_contents().counts())

    def test_writing_and_reading_a_directory(self):
        directory = os.path.join(tempfile.mkdtemp(), "marnstadt")
        write_demo_feed(directory)
        contents = load_feed(read_directory(directory), "Marnstadt")
        self.assertEqual(contents.counts(), demo_contents().counts())

    def test_the_document_round_trips(self):
        again = from_document(to_document(demo_contents()))
        self.assertEqual(document_digest(again), document_digest(demo_contents()))


if __name__ == "__main__":
    unittest.main()
