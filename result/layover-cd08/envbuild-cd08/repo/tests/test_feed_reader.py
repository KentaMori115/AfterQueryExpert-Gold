"""Reading feed tables out of text."""

import os
import tempfile
import unittest

from layover.errors import FeedError
from layover.feed.reader import RawFeed, read_directory, read_text
from tests.support import feed_texts, raw_feed


class ReadTextTest(unittest.TestCase):
    def test_reads_the_rows(self):
        table = read_text("stops", "stop_id,name\na,Stop A\nb,Stop B\n")
        self.assertEqual(len(table), 2)

    def test_keeps_the_header(self):
        table = read_text("stops", "stop_id,name\na,Stop A\n")
        self.assertEqual(table.header, ("stop_id", "name"))

    def test_numbers_rows_from_one(self):
        table = read_text("stops", "stop_id,name\na,Stop A\nb,Stop B\n")
        self.assertEqual([row.number for row in table], [1, 2])

    def test_skips_a_blank_line(self):
        table = read_text("stops", "stop_id,name\na,Stop A\n\nb,Stop B\n")
        self.assertEqual(len(table), 2)

    def test_a_blank_line_does_not_take_a_number(self):
        table = read_text("stops", "stop_id,name\na,Stop A\n\nb,Stop B\n")
        self.assertEqual(table.rows[1].number, 2)

    def test_trims_the_header(self):
        table = read_text("stops", " stop_id , name \na,Stop A\n")
        self.assertEqual(table.header, ("stop_id", "name"))

    def test_drops_a_byte_order_mark(self):
        table = read_text("stops", "﻿stop_id,name\na,Stop A\n")
        self.assertEqual(table.header[0], "stop_id")

    def test_reads_a_quoted_field(self):
        table = read_text("stops", 'stop_id,name\na,"Stop A, north"\n')
        self.assertEqual(table.rows[0].get("name"), "Stop A, north")

    def test_extra_columns_are_kept(self):
        table = read_text("stops", "stop_id,name,wheelchair\na,Stop A,1\n")
        self.assertEqual(table.rows[0].get("wheelchair"), "1")

    def test_a_table_with_no_rows_is_empty(self):
        self.assertTrue(read_text("stops", "stop_id,name\n").is_empty)

    def test_rejects_a_file_with_no_header(self):
        with self.assertRaises(FeedError):
            read_text("stops", "")

    def test_rejects_a_missing_required_column(self):
        with self.assertRaises(FeedError):
            read_text("stops", "stop_id\na\n")

    def test_rejects_a_repeated_column(self):
        with self.assertRaises(FeedError):
            read_text("stops", "stop_id,name,name\na,A,B\n")

    def test_rejects_a_short_row(self):
        with self.assertRaises(FeedError):
            read_text("stops", "stop_id,name\na\n")

    def test_rejects_a_long_row(self):
        with self.assertRaises(FeedError):
            read_text("stops", "stop_id,name\na,A,extra\n")

    def test_rejects_an_unknown_table(self):
        with self.assertRaises(FeedError):
            read_text("weather", "stop_id,name\n")

    def test_renders_its_row_count(self):
        self.assertEqual(str(read_text("stops", "stop_id,name\na,A\n")), "stops (1 rows)")


class RawRowTest(unittest.TestCase):
    def setUp(self):
        self.row = read_text("stops", "stop_id,name,lat\na,Stop A,\n").rows[0]

    def test_reads_a_field(self):
        self.assertEqual(self.row.get("name"), "Stop A")

    def test_a_blank_field_falls_back(self):
        self.assertEqual(self.row.get("lat", "0"), "0")

    def test_an_absent_column_falls_back(self):
        self.assertEqual(self.row.get("zone", "A"), "A")

    def test_has_a_filled_field(self):
        self.assertTrue(self.row.has("name"))

    def test_does_not_have_a_blank_field(self):
        self.assertFalse(self.row.has("lat"))

    def test_indexing_reads_a_field(self):
        self.assertEqual(self.row["name"], "Stop A")

    def test_membership_looks_at_the_columns(self):
        self.assertIn("lat", self.row)
        self.assertNotIn("zone", self.row)

    def test_the_place_points_at_the_row(self):
        where = self.row.where("name")
        self.assertEqual((where.table, where.row, where.field), ("stops", 1, "name"))

    def test_the_place_can_leave_out_the_column(self):
        self.assertIsNone(self.row.where().field)


class RawFeedTest(unittest.TestCase):
    def setUp(self):
        self.feed = raw_feed()

    def test_holds_every_table(self):
        self.assertEqual(len(self.feed), 11)

    def test_names_are_sorted(self):
        self.assertEqual(list(self.feed.names()), sorted(self.feed.names()))

    def test_finds_a_table(self):
        self.assertEqual(len(self.feed.table("stops")), 3)

    def test_an_absent_table_raises(self):
        feed = raw_feed(transfers=None)
        with self.assertRaises(FeedError):
            feed.table("transfers")

    def test_rows_of_an_absent_table_are_empty(self):
        self.assertEqual(raw_feed(transfers=None).rows("transfers"), ())

    def test_membership(self):
        self.assertIn("stops", self.feed)
        self.assertNotIn("weather", self.feed)

    def test_nothing_is_missing(self):
        self.assertEqual(self.feed.missing_tables(), ())

    def test_a_missing_required_table_is_reported(self):
        feed = RawFeed.of_text(feed_texts(trips=None))
        self.assertEqual(feed.missing_tables(), ("trips",))

    def test_the_check_passes(self):
        self.feed.check()

    def test_the_check_fails_without_trips(self):
        with self.assertRaises(FeedError):
            RawFeed.of_text(feed_texts(trips=None)).check()

    def test_the_check_fails_without_any_calendar(self):
        with self.assertRaises(FeedError):
            RawFeed.of_text(feed_texts(calendars=None, calendar_dates=None)).check()

    def test_one_kind_of_calendar_is_enough(self):
        RawFeed.of_text(feed_texts(calendars=None)).check()

    def test_counts_the_rows(self):
        self.assertEqual(self.feed.counts()["stop_times"], 6)

    def test_rejects_the_same_table_twice(self):
        with self.assertRaises(FeedError):
            RawFeed([self.feed.table("stops"), self.feed.table("stops")])

    def test_renders_its_source(self):
        self.assertEqual(str(self.feed), "11 tables from inline")

    def test_a_column_can_be_pulled_out(self):
        self.assertEqual(self.feed.table("stops").column("stop_id"), ("a", "b", "c"))


class ReadDirectoryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp()
        for name, text in feed_texts().items():
            with open(os.path.join(self.directory, "%s.csv" % name), "w", encoding="utf-8") as handle:
                handle.write(text)

    def test_reads_every_file(self):
        self.assertEqual(len(read_directory(self.directory)), 11)

    def test_records_the_source(self):
        self.assertEqual(read_directory(self.directory).source, self.directory)

    def test_ignores_a_file_the_format_does_not_know(self):
        with open(os.path.join(self.directory, "weather.csv"), "w", encoding="utf-8") as handle:
            handle.write("day,rain\n")
        self.assertEqual(len(read_directory(self.directory)), 11)

    def test_a_missing_optional_file_is_fine(self):
        os.remove(os.path.join(self.directory, "transfers.csv"))
        self.assertNotIn("transfers", read_directory(self.directory))

    def test_an_unknown_directory_raises(self):
        with self.assertRaises(FeedError):
            read_directory(os.path.join(self.directory, "nowhere"))

    def test_a_directory_with_no_tables_raises(self):
        empty = tempfile.mkdtemp()
        with self.assertRaises(FeedError):
            read_directory(empty)


if __name__ == "__main__":
    unittest.main()
