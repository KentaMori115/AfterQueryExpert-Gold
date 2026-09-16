"""The command line, run in process and as a program."""

import io
import os
import subprocess
import sys
import tempfile
import unittest

from layover.cli import FAILED, NOTHING_FOUND, OK, USAGE, describe_exit, main
from layover.demo import write_demo_feed


def run(*argv):
    """Run the command line and hand back its code and its output."""
    stream = io.StringIO()
    code = main(list(argv), stream)
    return code, stream.getvalue()


class UsageTest(unittest.TestCase):
    def test_no_command_is_a_usage_error(self):
        code, text = run()
        self.assertEqual(code, USAGE)
        self.assertIn("say what to do", text)

    def test_an_unknown_command_is_a_usage_error(self):
        self.assertEqual(run("fly")[0], USAGE)

    def test_a_missing_argument_is_a_usage_error(self):
        self.assertEqual(run("board")[0], USAGE)

    def test_an_unknown_option_is_a_usage_error(self):
        self.assertEqual(run("board", "westtor", "--colour")[0], USAGE)

    def test_a_bad_format_is_a_usage_error(self):
        self.assertEqual(run("--format", "pdf", "routes")[0], USAGE)

    def test_reading_two_feeds_is_a_usage_error(self):
        code, text = run("--feed", "a", "--document", "b", "routes")
        self.assertEqual(code, USAGE)
        self.assertIn("not both", text)

    def test_a_timetable_needs_a_route(self):
        self.assertEqual(run("timetable")[0], USAGE)

    def test_the_exit_codes_are_described(self):
        self.assertEqual(describe_exit(OK), "done")

    def test_an_unknown_exit_code_is_described(self):
        self.assertIn("unknown", describe_exit(99))


class BoardCommandTest(unittest.TestCase):
    def test_a_board_prints_departures(self):
        code, text = run("board", "westtor", "--after", "08:00", "--limit", "3")
        self.assertEqual(code, OK)
        self.assertIn("Departures from Westtor", text)

    def test_the_limit_is_respected(self):
        _, text = run("board", "westtor", "--after", "08:00", "--limit", "2", "--format", "csv")
        self.assertEqual(len(text.strip().splitlines()), 3)

    def test_a_route_filter_is_respected(self):
        _, text = run("board", "westtor", "--route", "t3", "--format", "csv")
        self.assertNotIn("U1", text)

    def test_an_empty_board_reports_nothing_found(self):
        code, _ = run("board", "inselsteg", "--after", "23:30")
        self.assertEqual(code, NOTHING_FOUND)

    def test_an_unknown_stop_fails(self):
        code, text = run("board", "nowhere")
        self.assertEqual(code, FAILED)
        self.assertIn("no such stop", text)

    def test_arrivals_print_too(self):
        code, text = run("arrivals", "ostfeld", "--after", "08:00", "--limit", "2")
        self.assertEqual(code, OK)
        self.assertIn("Arrivals at Ostfeld", text)


class PlanCommandTest(unittest.TestCase):
    def test_a_journey_is_planned(self):
        code, text = run("plan", "westtor", "hafen", "--after", "08:00")
        self.assertEqual(code, OK)
        self.assertIn("Journeys", text)

    def test_an_itinerary_shows_the_legs(self):
        _, text = run("plan", "westtor", "hafen", "--after", "08:00", "--itinerary")
        self.assertIn("walk", text)

    def test_a_fare_is_shown(self):
        _, text = run("plan", "westtor", "hafen", "--after", "08:00", "--fare")
        self.assertIn("Cheapest fare", text)

    def test_a_window_plans_several(self):
        _, text = run("plan", "westtor", "ostfeld", "--window", "08:00-09:00", "--format", "csv")
        self.assertGreater(len(text.strip().splitlines()), 3)

    def test_the_change_limit_is_respected(self):
        code, _ = run("plan", "westtor", "inselsteg", "--after", "09:00", "--changes", "0")
        self.assertEqual(code, NOTHING_FOUND)

    def test_no_journey_reports_nothing_found(self):
        code, text = run("plan", "westtor", "inselsteg", "--after", "23:00")
        self.assertEqual(code, NOTHING_FOUND)
        self.assertIn("No journey was found.", text)

    def test_a_journey_to_itself_fails(self):
        self.assertEqual(run("plan", "westtor", "westtor")[0], FAILED)


class ReportCommandTest(unittest.TestCase):
    def test_the_routes_command(self):
        code, text = run("routes")
        self.assertEqual(code, OK)
        self.assertIn("U1", text)

    def test_the_stops_command(self):
        _, text = run("stops")
        self.assertIn("Hauptbahnhof", text)

    def test_the_calendars_command(self):
        _, text = run("calendars")
        self.assertIn("weekday", text)

    def test_the_summary_command(self):
        _, text = run("summary")
        self.assertIn("Marnstadt", text)

    def test_the_timetable_command(self):
        _, text = run("timetable", "u1")
        self.assertIn("Westtor", text)

    def test_a_single_pattern_timetable(self):
        _, text = run("timetable", "--pattern", "u1-east")
        self.assertIn("Ostfeld", text)

    def test_a_windowed_timetable(self):
        _, text = run("timetable", "--pattern", "u1-east", "--window", "08:00-09:00", "--format", "csv")
        self.assertLessEqual(len(text.strip().splitlines()[0].split(",")), 5)

    def test_an_unknown_route_fails(self):
        self.assertEqual(run("timetable", "u9")[0], FAILED)

    def test_the_check_command_passes_on_the_demo(self):
        code, text = run("check")
        self.assertEqual(code, OK)
        self.assertIn("Nothing to report.", text)

    def test_a_single_check_can_be_run(self):
        self.assertEqual(run("check", "--only", "unused-stops")[0], OK)

    def test_an_unknown_check_fails_loudly(self):
        with self.assertRaises(KeyError):
            run("check", "--only", "no-such-check")

    def test_the_date_can_be_chosen(self):
        _, text = run("--date", "2026-07-19", "summary")
        self.assertIn("2026-07-19", text)

    def test_a_bad_date_fails(self):
        self.assertEqual(run("--date", "the fifteenth", "summary")[0], FAILED)


class DiagramCommandTest(unittest.TestCase):
    def test_a_route_is_drawn_in_both_directions(self):
        code, text = run("diagram", "u1")
        self.assertEqual(code, OK)
        self.assertEqual(text.count("Towards"), 2)

    def test_a_single_pattern_is_drawn(self):
        _, text = run("diagram", "--pattern", "u1-east")
        self.assertIn("Westtor", text)

    def test_the_interchange_is_marked(self):
        _, text = run("diagram", "--pattern", "u1-east")
        self.assertIn("U2", text)

    def test_a_diagram_needs_a_route(self):
        self.assertEqual(run("diagram")[0], USAGE)

    def test_an_unknown_route_fails(self):
        self.assertEqual(run("diagram", "u9")[0], FAILED)


class FrequencyCommandTest(unittest.TestCase):
    def test_the_frequency_table_by_stop(self):
        code, text = run("frequency", "--window", "07:00-09:00")
        self.assertEqual(code, OK)
        self.assertIn("Frequency at 07:00-09:00", text)

    def test_the_frequency_table_by_route(self):
        _, text = run("frequency", "--routes")
        self.assertIn("Route frequency", text)

    def test_a_single_stop_is_sliced_through_the_day(self):
        _, text = run("frequency", "hafen", "--format", "csv")
        self.assertEqual(len(text.strip().splitlines()), 25)

    def test_a_finer_step_makes_more_rows(self):
        _, text = run("frequency", "hafen", "--step", "1800", "--format", "csv")
        self.assertEqual(len(text.strip().splitlines()), 49)

    def test_an_unknown_stop_fails(self):
        self.assertEqual(run("frequency", "nowhere")[0], FAILED)


class FileCommandTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp()

    def test_saving_a_document(self):
        path = os.path.join(self.directory, "saved.json")
        code, text = run("save", path)
        self.assertEqual(code, OK)
        self.assertTrue(os.path.isfile(path))
        self.assertIn("Wrote", text)

    def test_exporting_a_feed(self):
        target = os.path.join(self.directory, "feed")
        code, text = run("export", target)
        self.assertEqual(code, OK)
        self.assertTrue(os.path.isdir(target))

    def test_reading_a_feed_back(self):
        target = os.path.join(self.directory, "feed")
        run("export", target)
        code, text = run("--feed", target, "summary")
        self.assertEqual(code, OK)
        self.assertIn("18", text)

    def test_reading_a_document_back(self):
        path = os.path.join(self.directory, "saved.json")
        run("save", path)
        code, text = run("--document", path, "routes")
        self.assertEqual(code, OK)
        self.assertIn("U1", text)

    def test_reading_a_missing_feed_fails(self):
        self.assertEqual(run("--feed", os.path.join(self.directory, "nope"), "routes")[0], FAILED)

    def test_reading_a_missing_document_fails(self):
        self.assertEqual(run("--document", os.path.join(self.directory, "nope.json"), "routes")[0], FAILED)

    def test_the_demo_command_summarises(self):
        code, text = run("demo", "--summary")
        self.assertEqual(code, OK)
        self.assertIn("trips", text)

    def test_the_demo_command_writes_a_feed(self):
        target = os.path.join(self.directory, "demo-feed")
        code, text = run("demo", "--write", target)
        self.assertEqual(code, OK)
        self.assertTrue(os.path.isfile(os.path.join(target, "stops.csv")))

    def test_the_demo_command_on_its_own(self):
        code, text = run("demo")
        self.assertEqual(code, OK)
        self.assertIn("Marnstadt", text)


class ProgramTest(unittest.TestCase):
    def program(self, *argv):
        return subprocess.run(
            [sys.executable, "-m", "layover", *argv],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )

    def test_help_works(self):
        finished = self.program("--help")
        self.assertEqual(finished.returncode, 0)
        self.assertIn("Timetables and journey planning.", finished.stdout)

    def test_the_demo_summary_works(self):
        finished = self.program("demo", "--summary")
        self.assertEqual(finished.returncode, 0)
        self.assertIn("trips", finished.stdout)

    def test_a_board_works(self):
        finished = self.program("board", "westtor", "--limit", "2")
        self.assertEqual(finished.returncode, 0)
        self.assertIn("Departures from Westtor", finished.stdout)

    def test_nothing_found_returns_three(self):
        finished = self.program("plan", "westtor", "inselsteg", "--after", "23:00")
        self.assertEqual(finished.returncode, NOTHING_FOUND)

    def test_a_usage_error_returns_two(self):
        finished = self.program("fly")
        self.assertEqual(finished.returncode, USAGE)

    def test_nothing_is_written_to_standard_error(self):
        finished = self.program("routes")
        self.assertEqual(finished.stderr, "")


if __name__ == "__main__":
    unittest.main()
