"""Writing a feed back out, and reading what was written."""

import os
import tempfile
import unittest

from layover.errors import FeedError
from layover.feed import RawFeed, feed_to_text, load_feed, read_directory, write_feed, write_table
from tests.support import loaded_feed


class WriteTableTest(unittest.TestCase):
    def test_writes_the_header_in_format_order(self):
        text = write_table("stops", [])
        self.assertTrue(text.startswith("stop_id,name,lat,lon,parent,kind,zone,code,platform"))

    def test_writes_a_row(self):
        text = write_table("stops", [{"stop_id": "a", "name": "Stop A"}])
        self.assertIn("a,Stop A,,,,,,,", text)

    def test_a_missing_value_is_blank(self):
        text = write_table("stops", [{"stop_id": "a", "name": "A", "lat": None}])
        self.assertIn("a,A,,", text)

    def test_true_is_written_as_one(self):
        text = write_table("pattern_stops", [{"pattern_id": "p", "sequence": 1, "stop_id": "a", "pickup": True}])
        self.assertIn("p,1,a,1,", text)

    def test_false_is_written_as_zero(self):
        text = write_table("pattern_stops", [{"pattern_id": "p", "sequence": 1, "stop_id": "a", "pickup": False}])
        self.assertIn("p,1,a,0,", text)

    def test_a_comma_is_quoted(self):
        text = write_table("stops", [{"stop_id": "a", "name": "Stop A, north"}])
        self.assertIn('"Stop A, north"', text)

    def test_an_unknown_column_raises(self):
        with self.assertRaises(FeedError):
            write_table("stops", [{"stop_id": "a", "name": "A", "altitude": "3"}])

    def test_an_unknown_table_raises(self):
        with self.assertRaises(FeedError):
            write_table("weather", [])

    def test_the_line_ending_is_a_newline(self):
        self.assertNotIn("\r", write_table("stops", [{"stop_id": "a", "name": "A"}]))


class FeedToTextTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.written = feed_to_text(self.contents)

    def test_writes_every_table_that_has_rows(self):
        self.assertEqual(len(self.written), 11)

    def test_leaves_out_an_empty_optional_table(self):
        contents = loaded_feed(transfers=None)
        self.assertNotIn("transfers", feed_to_text(contents))

    def test_keeps_a_required_table_even_when_empty(self):
        self.assertIn("stops", self.written)

    def test_writes_the_stops_in_identifier_order(self):
        lines = self.written["stops"].splitlines()[1:]
        self.assertEqual([line.split(",")[0] for line in lines], ["a", "b", "c"])

    def test_writes_a_coordinate_exactly(self):
        self.assertIn("52.500000,13.300000", self.written["stops"])

    def test_writes_the_pattern_stops_in_sequence(self):
        lines = self.written["pattern_stops"].splitlines()[1:]
        self.assertEqual([line.split(",")[1] for line in lines], ["1", "2", "3"])

    def test_writes_the_times_as_clock_strings(self):
        self.assertIn("08:00:00", self.written["stop_times"])

    def test_writes_the_calendar_weekdays(self):
        self.assertIn("weekday,1,1,1,1,1,0,0,2026-07-01,2026-07-31", self.written["calendars"])

    def test_writes_a_calendar_exception(self):
        self.assertIn("weekday,2026-07-14,remove", self.written["calendar_dates"])

    def test_writes_the_fares(self):
        self.assertIn("single,2.40,EUR,1,3600,Single", self.written["fare_products"])

    def test_writing_is_repeatable(self):
        self.assertEqual(feed_to_text(self.contents), self.written)


class RoundTripTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.again = load_feed(RawFeed.of_text(feed_to_text(self.contents)), "again")

    def test_the_counts_match(self):
        self.assertEqual(self.again.counts(), self.contents.counts())

    def test_the_stops_match(self):
        self.assertEqual(self.again.network.stops(), self.contents.network.stops())

    def test_the_patterns_match(self):
        self.assertEqual(self.again.network.patterns(), self.contents.network.patterns())

    def test_the_trips_match(self):
        self.assertEqual(self.again.network.trips(), self.contents.network.trips())

    def test_the_transfers_match(self):
        self.assertEqual(self.again.network.transfers(), self.contents.network.transfers())

    def test_the_calendars_match(self):
        for service_id in self.contents.services.ids():
            with self.subTest(service_id=service_id):
                self.assertEqual(
                    self.again.services.get(service_id).active_dates(),
                    self.contents.services.get(service_id).active_dates(),
                )

    def test_the_fares_match(self):
        self.assertEqual(self.again.fares.products(), self.contents.fares.products())

    def test_writing_twice_gives_the_same_text(self):
        self.assertEqual(feed_to_text(self.again), feed_to_text(self.contents))


class WriteDirectoryTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.directory = os.path.join(tempfile.mkdtemp(), "feed")

    def test_writes_the_files(self):
        written = write_feed(self.contents, self.directory)
        self.assertEqual(len(written), 11)

    def test_makes_the_directory(self):
        write_feed(self.contents, self.directory)
        self.assertTrue(os.path.isdir(self.directory))

    def test_what_is_written_reads_back(self):
        write_feed(self.contents, self.directory)
        again = load_feed(read_directory(self.directory))
        self.assertEqual(again.counts(), self.contents.counts())

    def test_writing_over_a_file_raises(self):
        path = os.path.join(tempfile.mkdtemp(), "not-a-directory")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("x")
        with self.assertRaises(FeedError):
            write_feed(self.contents, path)

    def test_writing_twice_is_fine(self):
        write_feed(self.contents, self.directory)
        self.assertEqual(len(write_feed(self.contents, self.directory)), 11)


if __name__ == "__main__":
    unittest.main()
