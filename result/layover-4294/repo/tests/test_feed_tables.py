"""The table and column definitions the feed format is written in."""

import unittest

from layover.errors import FeedError
from layover.feed.tables import REQUIRED_TABLES, TABLES, Column, table_named, table_names


class DefinitionTest(unittest.TestCase):
    def test_every_table_is_named(self):
        for name, table in TABLES.items():
            with self.subTest(name=name):
                self.assertEqual(table.name, name)

    def test_table_names_are_sorted(self):
        self.assertEqual(list(table_names()), sorted(table_names()))

    def test_the_core_tables_are_required(self):
        for name in ("stops", "routes", "patterns", "pattern_stops", "trips", "stop_times"):
            with self.subTest(name=name):
                self.assertIn(name, REQUIRED_TABLES)

    def test_fares_are_optional(self):
        self.assertNotIn("fare_products", REQUIRED_TABLES)

    def test_calendars_are_optional_on_their_own(self):
        self.assertNotIn("calendars", REQUIRED_TABLES)

    def test_every_required_table_exists(self):
        for name in REQUIRED_TABLES:
            with self.subTest(name=name):
                self.assertIn(name, TABLES)

    def test_every_key_column_is_defined(self):
        for table in TABLES.values():
            for column in table.key:
                with self.subTest(table=table.name, column=column):
                    self.assertTrue(table.has_column(column))

    def test_every_key_column_is_required(self):
        for table in TABLES.values():
            for column in table.key:
                with self.subTest(table=table.name, column=column):
                    self.assertTrue(table.column(column).required)

    def test_no_table_repeats_a_column(self):
        for table in TABLES.values():
            with self.subTest(table=table.name):
                names = table.column_names()
                self.assertEqual(len(names), len(set(names)))


class TableTest(unittest.TestCase):
    def setUp(self):
        self.stops = table_named("stops")

    def test_finds_a_table(self):
        self.assertEqual(self.stops.name, "stops")

    def test_an_unknown_table_raises(self):
        with self.assertRaises(FeedError):
            table_named("weather")

    def test_column_names_keep_their_order(self):
        self.assertEqual(self.stops.column_names()[:2], ("stop_id", "name"))

    def test_required_columns_are_listed(self):
        self.assertEqual(self.stops.required_names(), ("stop_id", "name"))

    def test_finds_a_column(self):
        self.assertEqual(self.stops.column("lat").name, "lat")

    def test_an_unknown_column_raises(self):
        with self.assertRaises(FeedError):
            self.stops.column("altitude")

    def test_missing_from_a_header(self):
        self.assertEqual(self.stops.missing_from(("stop_id",)), ("name",))

    def test_nothing_missing_from_a_full_header(self):
        self.assertEqual(self.stops.missing_from(self.stops.column_names()), ())

    def test_unknown_columns_in_a_header(self):
        self.assertEqual(self.stops.unknown_in(("stop_id", "name", "altitude")), ("altitude",))

    def test_a_required_column_renders_plainly(self):
        self.assertEqual(str(Column("stop_id", True)), "stop_id")

    def test_an_optional_column_renders_in_brackets(self):
        self.assertEqual(str(Column("lat")), "[lat]")

    def test_a_table_renders_its_columns(self):
        self.assertTrue(str(self.stops).startswith("stops(stop_id, name, [lat]"))


if __name__ == "__main__":
    unittest.main()
