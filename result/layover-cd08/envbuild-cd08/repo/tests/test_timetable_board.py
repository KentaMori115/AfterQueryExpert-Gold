"""Board entries: one call of one trip, seen from a date."""

import unittest
from datetime import date

from layover.timetable.board import BoardEntry
from layover.times import SECONDS_PER_DAY, parse_clock
from tests.support import MONDAY, line_network


def entry(index=2, offset=0):
    network = line_network()
    return BoardEntry(
        network.pattern("x-east").stops[index],
        network.trip("x-east-0"),
        network.pattern("x-east"),
        index,
        MONDAY,
        offset,
    )


class BoardEntryTest(unittest.TestCase):
    def setUp(self):
        self.entry = entry()

    def test_knows_its_trip(self):
        self.assertEqual(self.entry.trip_id, "x-east-0")

    def test_knows_its_route(self):
        self.assertEqual(self.entry.route_id, "x")

    def test_the_service_time_is_as_written(self):
        self.assertEqual(self.entry.service_departure, parse_clock("08:10"))

    def test_the_board_time_matches_on_the_same_day(self):
        self.assertEqual(self.entry.departure, self.entry.service_departure)

    def test_a_trip_from_yesterday_shifts_back(self):
        yesterday = entry(offset=-1)
        self.assertEqual(yesterday.departure, yesterday.service_departure - SECONDS_PER_DAY)

    def test_a_trip_from_yesterday_says_so(self):
        self.assertTrue(entry(offset=-1).from_yesterday)

    def test_a_trip_from_today_does_not(self):
        self.assertFalse(self.entry.from_yesterday)

    def test_the_board_date_is_the_service_date_today(self):
        self.assertEqual(self.entry.board_date, MONDAY)

    def test_the_board_date_is_the_day_after_for_a_late_trip(self):
        self.assertEqual(entry(offset=-1).board_date, date(2026, 7, 7))

    def test_arrival_and_departure_both_shift(self):
        yesterday = entry(offset=-1)
        self.assertEqual(yesterday.arrival, yesterday.service_arrival - SECONDS_PER_DAY)

    def test_the_headsign_comes_from_the_pattern(self):
        self.assertEqual(self.entry.headsign, "East")

    def test_the_destination_is_the_last_stop(self):
        self.assertEqual(self.entry.destination, "d")

    def test_the_first_call_is_the_origin(self):
        self.assertTrue(entry(index=0).is_origin)

    def test_a_middle_call_is_not(self):
        self.assertFalse(self.entry.is_origin)

    def test_the_last_call_is_the_destination(self):
        self.assertTrue(entry(index=3).is_destination)

    def test_boarding_is_allowed_in_the_middle(self):
        self.assertTrue(self.entry.can_board)

    def test_boarding_is_not_allowed_at_the_last_stop(self):
        self.assertFalse(entry(index=3).can_board)

    def test_alighting_is_not_allowed_at_the_first_stop(self):
        self.assertFalse(entry(index=0).can_alight)

    def test_the_stops_still_to_come(self):
        self.assertEqual(self.entry.stops_after(), ("d",))

    def test_nothing_comes_after_the_last_stop(self):
        self.assertEqual(entry(index=3).stops_after(), ())

    def test_the_sort_key_leads_with_the_departure(self):
        self.assertEqual(self.entry.sort_key()[0], self.entry.departure)

    def test_describes_itself_short(self):
        self.assertEqual(self.entry.describe(), "08:10 x East")

    def test_describes_itself_long(self):
        self.assertEqual(self.entry.describe(short=False), "08:10:00 x East")

    def test_renders_as_its_description(self):
        self.assertEqual(str(self.entry), self.entry.describe())

    def test_is_hashable(self):
        self.assertEqual(len({entry(), entry()}), 1)


if __name__ == "__main__":
    unittest.main()
