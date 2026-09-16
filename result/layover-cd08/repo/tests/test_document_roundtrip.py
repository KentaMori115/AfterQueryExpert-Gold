"""Saving a feed, reading it back and getting the same thing."""

import os
import tempfile
import unittest

from layover.document import (
    FORMAT,
    SECTIONS,
    VERSION,
    check_document,
    digest_of,
    document_digest,
    empty_document,
    from_document,
    load_document,
    read_document,
    save_document,
    to_document,
    write_document,
)
from layover.errors import DocumentError
from tests.support import loaded_feed


class SchemaTest(unittest.TestCase):
    def test_an_empty_document_is_current(self):
        self.assertEqual(empty_document()["version"], VERSION)

    def test_an_empty_document_has_every_section(self):
        document = empty_document()
        for name in SECTIONS:
            with self.subTest(name=name):
                self.assertEqual(document[name], [])

    def test_an_empty_document_passes_the_check(self):
        check_document(empty_document())

    def test_a_document_of_another_format_is_refused(self):
        document = empty_document()
        document["format"] = "something-else"
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_a_document_with_no_version_is_refused(self):
        document = empty_document()
        document["version"] = "three"
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_a_future_version_is_refused(self):
        document = empty_document()
        document["version"] = VERSION + 1
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_a_missing_section_is_refused(self):
        document = empty_document()
        del document["stops"]
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_a_section_that_is_not_a_list_is_refused(self):
        document = empty_document()
        document["stops"] = {}
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_fares_may_be_absent(self):
        check_document(empty_document())

    def test_fares_that_are_not_a_mapping_are_refused(self):
        document = empty_document()
        document["fares"] = []
        with self.assertRaises(DocumentError):
            check_document(document)

    def test_something_that_is_not_a_mapping_is_refused(self):
        with self.assertRaises(DocumentError):
            check_document([])


class WriteTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.document = to_document(self.contents)

    def test_the_format_is_tagged(self):
        self.assertEqual(self.document["format"], FORMAT)

    def test_the_version_is_current(self):
        self.assertEqual(self.document["version"], VERSION)

    def test_the_name_carries_through(self):
        self.assertEqual(self.document["name"], "inline")

    def test_the_stops_are_written(self):
        self.assertEqual(len(self.document["stops"]), 3)

    def test_a_position_is_written_as_microdegrees(self):
        self.assertEqual(self.document["stops"][0]["lat"], 52500000)

    def test_the_trips_hold_whole_seconds(self):
        self.assertIsInstance(self.document["trips"][0]["arrivals"][0], int)

    def test_the_calendars_are_written(self):
        self.assertEqual(self.document["calendars"][0]["id"], "weekday")

    def test_a_calendar_exception_is_written(self):
        self.assertEqual(self.document["calendars"][0]["removed"], ["2026-07-14"])

    def test_the_fares_are_written(self):
        self.assertEqual(self.document["fares"]["products"][0]["price"], "2.40")

    def test_a_feed_with_no_fares_writes_none(self):
        document = to_document(loaded_feed(fare_products=None, fare_rules=None))
        self.assertIsNone(document["fares"])

    def test_writing_twice_gives_the_same_document(self):
        self.assertEqual(to_document(self.contents), self.document)

    def test_the_document_passes_its_own_check(self):
        check_document(self.document)


class RoundTripTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.again = from_document(to_document(self.contents))

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
        self.assertEqual(
            self.again.services.get("weekday").active_dates(),
            self.contents.services.get("weekday").active_dates(),
        )

    def test_the_fares_match(self):
        self.assertEqual(self.again.fares.products(), self.contents.fares.products())

    def test_the_digest_matches(self):
        self.assertEqual(document_digest(self.again), document_digest(self.contents))

    def test_a_second_round_trip_changes_nothing(self):
        third = from_document(to_document(self.again))
        self.assertEqual(document_digest(third), document_digest(self.contents))

    def test_a_feed_with_no_fares_round_trips(self):
        plain = loaded_feed(fare_products=None, fare_rules=None)
        self.assertIsNone(from_document(to_document(plain)).fares)

    def test_a_row_missing_its_identifier_is_refused(self):
        document = to_document(self.contents)
        del document["stops"][0]["id"]
        with self.assertRaises(DocumentError):
            from_document(document)

    def test_a_time_that_is_not_whole_is_refused(self):
        document = to_document(self.contents)
        document["trips"][0]["arrivals"][0] = "08:00:00"
        with self.assertRaises(DocumentError):
            from_document(document)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()
        self.path = os.path.join(tempfile.mkdtemp(), "nested", "network.json")

    def test_saving_makes_the_file(self):
        save_document(self.contents, self.path)
        self.assertTrue(os.path.isfile(self.path))

    def test_what_is_saved_loads_again(self):
        save_document(self.contents, self.path)
        self.assertEqual(load_document(self.path).counts(), self.contents.counts())

    def test_the_file_is_json_with_sorted_keys(self):
        save_document(self.contents, self.path)
        with open(self.path, "r", encoding="utf-8") as handle:
            text = handle.read()
        self.assertTrue(text.startswith("{\n"))
        self.assertLess(text.index('"agencies"'), text.index('"stops"'))

    def test_the_file_ends_with_a_newline(self):
        save_document(self.contents, self.path)
        with open(self.path, "r", encoding="utf-8") as handle:
            self.assertTrue(handle.read().endswith("\n"))

    def test_saving_twice_writes_the_same_bytes(self):
        save_document(self.contents, self.path)
        with open(self.path, "r", encoding="utf-8") as handle:
            first = handle.read()
        save_document(self.contents, self.path)
        with open(self.path, "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), first)

    def test_reading_a_missing_file_raises(self):
        with self.assertRaises(DocumentError):
            read_document(self.path)

    def test_reading_something_that_is_not_json_raises(self):
        path = os.path.join(tempfile.mkdtemp(), "bad.json")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("not json")
        with self.assertRaises(DocumentError):
            read_document(path)

    def test_reading_a_json_list_raises(self):
        path = os.path.join(tempfile.mkdtemp(), "list.json")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("[]")
        with self.assertRaises(DocumentError):
            read_document(path)

    def test_writing_a_document_with_a_float_raises(self):
        with self.assertRaises(DocumentError):
            write_document({"format": "layover-network", "version": 3, "a": 1.5}, self.path)

    def test_the_digest_of_a_saved_feed(self):
        self.assertEqual(document_digest(self.contents), digest_of(to_document(self.contents)))


if __name__ == "__main__":
    unittest.main()
