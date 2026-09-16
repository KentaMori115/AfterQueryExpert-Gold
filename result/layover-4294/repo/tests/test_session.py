"""The façade over a loaded feed."""

import os
import tempfile
import unittest

from layover.demo import DEMO_DATE, DEMO_SUNDAY, demo_contents, write_demo_feed
from layover.errors import PlanError
from layover.plan import SearchOptions
from layover.session import Session
from layover.times import TimeWindow, parse_clock
from tests.support import loaded_feed


class OpenTest(unittest.TestCase):
    def test_the_demo_opens(self):
        self.assertEqual(Session.demo().name, "Marnstadt")

    def test_a_feed_directory_opens(self):
        directory = os.path.join(tempfile.mkdtemp(), "feed")
        write_demo_feed(directory)
        session = Session.from_feed(directory)
        self.assertEqual(len(session.network), len(demo_contents().network))

    def test_a_document_opens(self):
        path = os.path.join(tempfile.mkdtemp(), "network.json")
        Session.demo().save(path)
        self.assertEqual(Session.from_document(path).digest(), Session.demo().digest())

    def test_it_renders_a_summary(self):
        self.assertTrue(str(Session.demo()).startswith("Marnstadt: "))

    def test_the_network_comes_through(self):
        self.assertIs(Session.demo().network, demo_contents().network)

    def test_the_services_come_through(self):
        self.assertIs(Session.demo().services, demo_contents().services)

    def test_the_fares_come_through(self):
        self.assertIs(Session.demo().fares, demo_contents().fares)

    def test_the_zones_are_worked_out_once(self):
        session = Session.demo()
        self.assertIs(session.zones(), session.zones())

    def test_settings_can_be_changed(self):
        session = Session.demo().with_options(SearchOptions(max_transfers=0))
        self.assertEqual(session.options.max_transfers, 0)

    def test_changing_settings_keeps_the_feed(self):
        session = Session.demo().with_options(SearchOptions(max_transfers=0))
        self.assertIs(session.contents, demo_contents())


class AskTest(unittest.TestCase):
    def setUp(self):
        self.session = Session.demo()

    def test_departures_from_a_stop(self):
        found = self.session.departures("westtor", DEMO_DATE, parse_clock("08:00"), 3)
        self.assertEqual(len(found), 3)

    def test_arrivals_at_a_stop(self):
        found = self.session.arrivals("ostfeld", DEMO_DATE, parse_clock("08:00"), 3)
        self.assertEqual(len(found), 3)

    def test_a_board_as_a_report(self):
        report = self.session.board("westtor", DEMO_DATE, parse_clock("08:00"), 3)
        self.assertEqual(len(report), 3)

    def test_an_arrival_board_as_a_report(self):
        report = self.session.arrival_board("ostfeld", DEMO_DATE, parse_clock("08:00"), 2)
        self.assertEqual(len(report), 2)

    def test_planning_a_journey(self):
        journeys = self.session.plan("westtor", "hafen", DEMO_DATE, parse_clock("08:00"))
        self.assertTrue(journeys)

    def test_planning_a_window(self):
        found = self.session.plan_window(
            "westtor", "ostfeld", DEMO_DATE, TimeWindow.parse("08:00-09:00")
        )
        self.assertGreater(len(found), 1)

    def test_what_is_reachable(self):
        found = self.session.reachable("westtor", DEMO_DATE, parse_clock("08:00"))
        self.assertIn("hafen", found)

    def test_pricing_a_journey(self):
        journey = self.session.plan("westtor", "ostfeld", DEMO_DATE, parse_clock("08:00"))[0]
        self.assertEqual(str(self.session.price(journey).total), "2.40 EUR")

    def test_pricing_a_crossing_journey(self):
        journey = self.session.plan("ostfeld", "flughafen", DEMO_DATE, parse_clock("08:00"))[0]
        self.assertEqual(str(self.session.price(journey).total), "3.60 EUR")

    def test_pricing_without_fares_raises(self):
        session = Session(loaded_feed(fare_products=None, fare_rules=None))
        journey = session.plan("a", "c", DEMO_DATE.replace(day=6), parse_clock("07:00"))
        with self.assertRaises(PlanError):
            session.price(journey[0])

    def test_an_itinerary(self):
        journey = self.session.plan("westtor", "hafen", DEMO_DATE, parse_clock("08:00"))[0]
        self.assertIn("Westtor", self.session.itinerary(journey).as_text())

    def test_a_priced_itinerary(self):
        journey = self.session.plan("westtor", "hafen", DEMO_DATE, parse_clock("08:00"))[0]
        report = self.session.itinerary(journey, priced=True)
        self.assertTrue(any(note.startswith("Fare") for note in report.notes))

    def test_a_list_of_journeys(self):
        journeys = self.session.plan("westtor", "hafen", DEMO_DATE, parse_clock("08:00"))
        self.assertEqual(len(self.session.journeys_report(journeys)), len(journeys))


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.session = Session.demo()

    def test_the_pattern_timetable(self):
        report = self.session.pattern_timetable("u1-east", DEMO_DATE)
        self.assertEqual(len(report), 5)

    def test_the_route_timetable_has_both_directions(self):
        self.assertEqual(len(self.session.route_timetable("u1", DEMO_DATE)), 2)

    def test_a_line_diagram(self):
        self.assertEqual(len(self.session.diagram("u1-east")), 5)

    def test_a_route_diagram_has_both_directions(self):
        self.assertEqual(len(self.session.route_diagram("u1")), 2)

    def test_the_routes_report(self):
        self.assertEqual(len(self.session.routes(DEMO_DATE)), 6)

    def test_the_stops_report(self):
        self.assertEqual(len(self.session.stops(DEMO_DATE)), 18)

    def test_the_calendars_report(self):
        self.assertEqual(len(self.session.calendars()), 3)

    def test_the_service_day_report(self):
        self.assertEqual(len(self.session.service_day(DEMO_DATE)), 6)

    def test_a_sunday_runs_fewer_routes(self):
        self.assertLessEqual(len(self.session.service_day(DEMO_SUNDAY)), 6)

    def test_the_summary_report(self):
        self.assertIn("Marnstadt", self.session.summary().as_text())

    def test_the_checks_pass(self):
        self.assertTrue(self.session.check().clean)

    def test_a_single_check_can_be_run(self):
        self.assertTrue(self.session.check(only=["unused-stops"]).clean)


class SaveTest(unittest.TestCase):
    def setUp(self):
        self.session = Session.demo()
        self.path = os.path.join(tempfile.mkdtemp(), "saved.json")

    def test_the_document_holds_the_stops(self):
        self.assertEqual(len(self.session.document()["stops"]), 18)

    def test_the_digest_is_stable(self):
        self.assertEqual(self.session.digest(), Session.demo().digest())

    def test_saving_writes_the_file(self):
        self.session.save(self.path)
        self.assertTrue(os.path.isfile(self.path))

    def test_what_is_saved_loads_back(self):
        self.session.save(self.path)
        self.assertEqual(Session.from_document(self.path).digest(), self.session.digest())


if __name__ == "__main__":
    unittest.main()
