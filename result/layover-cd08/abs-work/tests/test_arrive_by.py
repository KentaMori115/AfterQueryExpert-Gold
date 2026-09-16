"""Journeys planned against a deadline: what comes back, how it prints, how it runs."""

import io
import unittest

from datetime import date

from layover.cli import NOTHING_FOUND, OK, USAGE, main
from layover.demo import demo_contents
from layover.errors import PlanError
from layover.plan import SearchOptions
from layover.report.journey import arrive_by_report
from layover.session import Session
from layover.times import parse_clock

from tests.test_plan_backward import (
    MONDAY,
    change_network,
    clock,
    services,
    stepped_network,
    timetable_of,
)

DEMO_DAY = date(2026, 7, 15)


def run(*argv):
    """Run the command line in process and hand back its code and its output."""
    stream = io.StringIO()
    code = main(list(argv), stream)
    return code, stream.getvalue()


def session_of(network, options=None):
    """A session over a hand built network, without going through a feed."""
    from layover.feed.load import FeedContents

    return Session(FeedContents(network, services(), None, "built"), options)


class PlanArrivingByTest(unittest.TestCase):
    """What the deadline search hands back."""

    def setUp(self):
        self.session = session_of(change_network())

    def test_the_journey_leaves_as_late_as_it_can(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        self.assertEqual(len(journeys), 1)
        self.assertEqual(journeys[0].departure, clock("08:40"))

    def test_it_takes_the_soonest_arrival_after_that_departure(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        self.assertEqual(journeys[0].arrival, clock("08:53"))

    def test_it_rides_the_quicker_onward_leg_rather_than_the_latest_one(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        self.assertEqual(journeys[0].routes(), ("one", "three"))

    def test_nothing_that_would_turn_up_late_is_offered(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        for journey in journeys:
            self.assertLessEqual(journey.arrival, clock("09:10"))

    def test_a_later_deadline_lets_the_single_vehicle_run_win(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:20"))
        self.assertEqual(len(journeys), 1)
        self.assertEqual(journeys[0].transfers, 0)
        self.assertEqual(journeys[0].departure, clock("08:45"))

    def test_a_deadline_nothing_can_meet_gives_nothing_back(self):
        self.assertEqual(self.session.plan_arriving_by("p", "s", MONDAY, clock("08:05")), ())

    def test_the_journeys_join_up_end_to_end(self):
        journeys = self.session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        journey = journeys[0]
        self.assertEqual(journey.origin, "p")
        self.assertEqual(journey.destination, "s")
        self.assertEqual(journey.stops()[0], "p")

    def test_planning_to_where_you_already_are_is_refused(self):
        with self.assertRaises(PlanError):
            self.session.plan_arriving_by("p", "p", MONDAY, clock("09:10"))

    def test_the_sessions_own_settings_are_used(self):
        session = session_of(change_network(), SearchOptions(max_transfers=0))
        journeys = session.plan_arriving_by("p", "s", MONDAY, clock("09:10"))
        self.assertEqual(journeys, ())


class SessionTest(unittest.TestCase):
    """The three ways a session asks the question."""

    def setUp(self):
        self.session = session_of(stepped_network())

    def test_the_latest_departure_is_a_moment_on_the_service_day(self):
        found = self.session.latest_departure("a", "d", MONDAY, clock("08:50"))
        self.assertEqual(found, clock("08:30"))

    def test_the_latest_departure_is_nothing_when_nothing_works(self):
        self.assertIsNone(self.session.latest_departure("a", "d", MONDAY, clock("08:14")))

    def test_reaching_answers_for_every_stop_at_once(self):
        latest = self.session.reaching("d", MONDAY, clock("08:50"))
        self.assertEqual(latest, {"a": clock("08:30"), "b": clock("08:35"), "c": clock("08:40")})

    def test_the_journey_leaves_when_the_moment_says_it_does(self):
        journeys = self.session.plan_arriving_by("a", "d", MONDAY, clock("08:50"))
        latest = self.session.latest_departure("a", "d", MONDAY, clock("08:50"))
        self.assertEqual(journeys[0].departure, latest)

    def test_a_session_with_tighter_settings_answers_differently(self):
        session = session_of(stepped_network(), SearchOptions(search_window=600))
        self.assertIsNone(session.latest_departure("a", "d", MONDAY, clock("12:00")))

    def test_the_demo_is_answered_for_too(self):
        session = Session(demo_contents())
        found = session.latest_departure("westtor", "flughafen", DEMO_DAY, parse_clock("09:00"))
        self.assertEqual(found, parse_clock("08:00"))


class ReportTest(unittest.TestCase):
    """The report a deadline search prints."""

    def setUp(self):
        self.timetable = timetable_of(change_network())
        self.session = session_of(change_network())
        self.by = clock("09:10")
        self.journeys = self.session.plan_arriving_by("p", "s", MONDAY, self.by)

    def test_the_title_names_the_deadline(self):
        report = arrive_by_report(self.journeys, self.timetable.network, self.by)
        self.assertEqual(report.title, "Arriving by 09:10")

    def test_the_spare_time_sits_between_the_changes_and_the_routes(self):
        report = arrive_by_report(self.journeys, self.timetable.network, self.by)
        self.assertEqual(
            report.headers, ("Leaves", "Arrives", "Takes", "Changes", "Spare", "Using")
        )

    def test_a_row_says_how_long_is_left_over(self):
        report = arrive_by_report(self.journeys, self.timetable.network, self.by)
        self.assertEqual(report.rows[0][4], "17m")

    def test_a_row_reads_the_way_a_list_of_options_reads(self):
        report = arrive_by_report(self.journeys, self.timetable.network, self.by)
        self.assertEqual(report.rows[0][0], "08:40")
        self.assertEqual(report.rows[0][1], "08:53")
        self.assertEqual(report.rows[0][3], "1")

    def test_no_journeys_leaves_a_note_instead_of_rows(self):
        report = arrive_by_report((), self.timetable.network, self.by)
        self.assertEqual(report.rows, ())
        self.assertEqual(report.notes, ("No journey was found.",))

    def test_the_session_builds_the_same_report(self):
        report = self.session.arrive_by_report(self.journeys, self.by)
        self.assertEqual(report.title, "Arriving by 09:10")
        self.assertEqual(report.rows[0][4], "17m")

    def test_it_renders_as_text_with_the_deadline_on_top(self):
        text = self.session.arrive_by_report(self.journeys, self.by).as_text()
        self.assertTrue(text.startswith("Arriving by 09:10"))
        self.assertIn("Spare", text)


class ArriveCommandTest(unittest.TestCase):
    """``python -m layover arrive`` over the demo network."""

    def test_it_prints_the_journeys_that_land_in_time(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "09:00")
        self.assertEqual(code, OK)
        self.assertIn("Arriving by 09:00", text)

    def test_the_row_shows_the_time_left_over(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "09:00")
        self.assertEqual(code, OK)
        self.assertIn("19m", text)

    def test_the_latest_flag_prints_the_moment_and_nothing_else(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "09:00", "--latest")
        self.assertEqual(code, OK)
        self.assertEqual(text.strip(), "08:00")

    def test_an_itinerary_shows_every_leg(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "09:00", "--itinerary")
        self.assertEqual(code, OK)
        self.assertIn("Westtor", text)
        self.assertIn("Arrives 08:41", text)

    def test_a_deadline_nothing_can_meet_is_not_a_crash(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "05:00")
        self.assertEqual(code, NOTHING_FOUND)
        self.assertIn("No journey was found.", text)

    def test_the_latest_flag_says_the_same_when_nothing_works(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "05:00", "--latest")
        self.assertEqual(code, NOTHING_FOUND)
        self.assertIn("No journey was found.", text)

    def test_the_number_of_changes_can_be_held_down(self):
        code, text = run(
            "arrive", "westtor", "flughafen", "--by", "09:00", "--changes", "0"
        )
        self.assertEqual(code, NOTHING_FOUND)

    def test_a_fare_can_be_asked_for(self):
        code, text = run("arrive", "westtor", "flughafen", "--by", "09:00", "--fare")
        self.assertEqual(code, OK)
        self.assertIn("Cheapest fare", text)

    def test_the_date_can_be_moved(self):
        code, text = run(
            "arrive", "westtor", "flughafen", "--by", "09:00", "--date", "2026-07-19"
        )
        self.assertEqual(code, OK)

    def test_it_renders_as_markdown_when_asked(self):
        code, text = run(
            "arrive", "westtor", "flughafen", "--by", "09:00", "--format", "markdown"
        )
        self.assertEqual(code, OK)
        self.assertIn("| Leaves |", text)

    def test_it_still_needs_two_stops(self):
        self.assertEqual(run("arrive", "westtor")[0], USAGE)

    def test_an_unknown_stop_is_a_failure_rather_than_a_crash(self):
        code, text = run("arrive", "nowhere", "flughafen", "--by", "09:00")
        self.assertNotEqual(code, OK)
        self.assertIn("nowhere", text)


if __name__ == "__main__":
    unittest.main()
