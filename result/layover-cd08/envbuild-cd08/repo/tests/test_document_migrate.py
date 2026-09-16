"""Bringing older documents up to the current version."""

import unittest

from layover.document import VERSION, from_document, migrate, migration_path
from layover.errors import DocumentError


def version_one():
    return {
        "format": "layover-network",
        "version": 1,
        "name": "old",
        "stops": [
            {"id": "a", "name": "Stop A", "lat": "52.500000", "lon": "13.300000", "zone": "A"},
            {"id": "b", "name": "Stop B", "lat": "52.500000", "lon": "13.320000", "zone": "A"},
        ],
        "routes": [{"id": "x", "short_name": "X", "mode": "tram"}],
        "patterns": [{"id": "x-out", "route": "x", "stops": ["a", "b"]}],
        "trips": [
            {
                "id": "t1",
                "pattern": "x-out",
                "service": "weekday",
                "times": ["08:00:00", "08:10:00"],
            }
        ],
        "calendars": [
            {
                "id": "weekday",
                "weekdays": 31,
                "start": "2026-07-01",
                "end": "2026-07-31",
                "added": [],
                "removed": [],
            }
        ],
    }


def version_two():
    document = migrate(version_one())
    document["version"] = 2
    document["stops"] = [
        dict(stop, lat="52.500000", lon="13.300000") for stop in document["stops"]
    ]
    document["trips"] = [
        {
            "id": "t1",
            "pattern": "x-out",
            "service": "weekday",
            "times": [["08:00:00", "08:00:30"], ["08:10:00", "08:10:00"]],
        }
    ]
    return document


class PathTest(unittest.TestCase):
    def test_a_current_document_needs_no_step(self):
        self.assertEqual(migration_path(VERSION), ())

    def test_version_two_needs_one_step(self):
        self.assertEqual(migration_path(2), (2,))

    def test_version_one_needs_two_steps(self):
        self.assertEqual(migration_path(1), (1, 2))

    def test_an_unknown_version_raises(self):
        with self.assertRaises(DocumentError):
            migration_path(9)

    def test_version_zero_raises(self):
        with self.assertRaises(DocumentError):
            migration_path(0)


class MigrateOneTest(unittest.TestCase):
    def setUp(self):
        self.migrated = migrate(version_one())

    def test_it_becomes_current(self):
        self.assertEqual(self.migrated["version"], VERSION)

    def test_the_boarding_flags_are_added(self):
        pattern = self.migrated["patterns"][0]
        self.assertEqual(pattern["pickup"], [True, False])
        self.assertEqual(pattern["dropoff"], [False, True])

    def test_a_transfers_section_appears(self):
        self.assertEqual(self.migrated["transfers"], [])

    def test_an_agencies_section_appears(self):
        self.assertEqual(self.migrated["agencies"], [])

    def test_there_are_no_fares(self):
        self.assertIsNone(self.migrated["fares"])

    def test_coordinates_become_whole_numbers(self):
        self.assertEqual(self.migrated["stops"][0]["lat"], 52500000)

    def test_times_become_whole_seconds(self):
        self.assertEqual(self.migrated["trips"][0]["arrivals"], [28800, 29400])

    def test_the_departures_are_filled_in(self):
        self.assertEqual(self.migrated["trips"][0]["departures"], [28800, 29400])

    def test_the_name_is_kept(self):
        self.assertEqual(self.migrated["name"], "old")

    def test_the_migrated_document_loads(self):
        contents = from_document(self.migrated)
        self.assertEqual(len(contents.network), 2)

    def test_the_loaded_trip_has_its_times(self):
        contents = from_document(self.migrated)
        self.assertEqual(contents.network.trip("t1").departures[0], 28800)

    def test_a_pattern_with_one_stop_is_refused(self):
        document = version_one()
        document["patterns"][0]["stops"] = ["a"]
        with self.assertRaises(DocumentError):
            migrate(document)


class MigrateTwoTest(unittest.TestCase):
    def setUp(self):
        self.migrated = migrate(version_two())

    def test_it_becomes_current(self):
        self.assertEqual(self.migrated["version"], VERSION)

    def test_the_uneven_stand_survives(self):
        trip = self.migrated["trips"][0]
        self.assertEqual(trip["departures"][0] - trip["arrivals"][0], 30)

    def test_the_coordinates_are_converted(self):
        self.assertEqual(self.migrated["stops"][0]["lat"], 52500000)

    def test_the_flags_are_left_alone(self):
        self.assertEqual(self.migrated["patterns"][0]["pickup"], [True, False])

    def test_it_loads(self):
        self.assertEqual(len(from_document(self.migrated).network), 2)

    def test_a_call_that_is_not_a_pair_is_refused(self):
        document = version_two()
        document["trips"][0]["times"] = [["08:00", "08:01", "08:02"], "08:10"]
        with self.assertRaises(DocumentError):
            migrate(document)

    def test_a_time_that_is_a_flag_is_refused(self):
        document = version_two()
        document["trips"][0]["times"] = [True, "08:10"]
        with self.assertRaises(DocumentError):
            migrate(document)


class MigrateCurrentTest(unittest.TestCase):
    def test_a_current_document_is_unchanged(self):
        document = migrate(version_one())
        self.assertEqual(migrate(document), document)

    def test_a_document_of_another_format_is_refused(self):
        document = migrate(version_one())
        document["format"] = "something-else"
        with self.assertRaises(DocumentError):
            migrate(document)

    def test_something_that_is_not_a_mapping_is_refused(self):
        with self.assertRaises(DocumentError):
            migrate("a document")

    def test_migrating_is_repeatable(self):
        self.assertEqual(migrate(version_one()), migrate(version_one()))


if __name__ == "__main__":
    unittest.main()
