"""Trips, their times and the calls they make."""

import unittest

from layover.errors import NetworkError
from layover.network.trips import StopCall, Trip
from layover.times import SECONDS_PER_DAY, parse_clock


def trip(**changes):
    settings = dict(
        trip_id="t1",
        pattern_id="p",
        service_id="weekday",
        times=["08:00", "08:05", "08:12"],
    )
    settings.update(changes)
    return Trip.from_times(**settings)


class BuildTest(unittest.TestCase):
    def test_reads_clock_times(self):
        self.assertEqual(trip().departures[0], parse_clock("08:00"))

    def test_reads_whole_seconds(self):
        self.assertEqual(Trip.from_times("t", "p", "s", [60, 120]).arrivals, (60, 120))

    def test_reads_a_pair_for_an_uneven_stand(self):
        made = Trip.from_times("t", "p", "s", [("08:00", "08:02"), "08:10"])
        self.assertEqual(made.dwell_at(0), 120)

    def test_an_even_dwell_applies_to_every_call(self):
        made = Trip.from_times("t", "p", "s", ["08:00", "08:05", "08:12"], dwell=30)
        self.assertEqual(made.dwell_at(1), 30)

    def test_the_last_call_never_stands(self):
        made = Trip.from_times("t", "p", "s", ["08:00", "08:05"], dwell=30)
        self.assertEqual(made.dwell_at(1), 0)

    def test_rejects_a_call_that_is_not_a_pair(self):
        with self.assertRaises(NetworkError):
            Trip.from_times("t", "p", "s", [("08:00", "08:02", "08:04"), "08:10"])

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(NetworkError):
            trip(trip_id="  ")

    def test_rejects_a_missing_pattern(self):
        with self.assertRaises(NetworkError):
            trip(pattern_id=" ")

    def test_rejects_a_missing_service(self):
        with self.assertRaises(NetworkError):
            trip(service_id=" ")

    def test_rejects_a_single_call(self):
        with self.assertRaises(NetworkError):
            trip(times=["08:00"])

    def test_rejects_mismatched_lists(self):
        with self.assertRaises(NetworkError):
            Trip("t", "p", "s", (0, 60), (0,))

    def test_rejects_leaving_before_arriving(self):
        with self.assertRaises(NetworkError):
            Trip("t", "p", "s", (100, 200), (50, 200))

    def test_rejects_going_back_in_time(self):
        with self.assertRaises(NetworkError):
            Trip("t", "p", "s", (100, 50), (100, 50))

    def test_rejects_a_negative_time(self):
        with self.assertRaises(NetworkError):
            Trip("t", "p", "s", (-60, 60), (-60, 60))

    def test_allows_standing_still_between_calls(self):
        self.assertEqual(len(Trip("t", "p", "s", (100, 100), (100, 100))), 2)

    def test_is_hashable(self):
        self.assertEqual(len({trip(), trip()}), 1)


class TimesTest(unittest.TestCase):
    def setUp(self):
        self.trip = trip()

    def test_starts_at_the_first_departure(self):
        self.assertEqual(self.trip.start_time, parse_clock("08:00"))

    def test_ends_at_the_last_arrival(self):
        self.assertEqual(self.trip.end_time, parse_clock("08:12"))

    def test_duration_is_end_less_start(self):
        self.assertEqual(self.trip.duration, 12 * 60)

    def test_the_window_covers_the_run(self):
        self.assertTrue(self.trip.window.contains(parse_clock("08:06")))

    def test_the_window_excludes_before_the_start(self):
        self.assertFalse(self.trip.window.contains(parse_clock("07:59")))

    def test_arrival_at_a_call(self):
        self.assertEqual(self.trip.arrival_at(1), parse_clock("08:05"))

    def test_departure_at_a_call(self):
        self.assertEqual(self.trip.departure_at(1), parse_clock("08:05"))

    def test_a_call_past_the_end_raises(self):
        with self.assertRaises(NetworkError):
            self.trip.arrival_at(9)

    def test_a_negative_call_raises(self):
        with self.assertRaises(NetworkError):
            self.trip.departure_at(-1)

    def test_travel_time_between_calls(self):
        self.assertEqual(self.trip.travel_time(0, 2), 12 * 60)

    def test_travel_time_backwards_raises(self):
        with self.assertRaises(NetworkError):
            self.trip.travel_time(2, 0)

    def test_travel_time_to_the_same_call_raises(self):
        with self.assertRaises(NetworkError):
            self.trip.travel_time(1, 1)

    def test_a_daytime_trip_does_not_cross_midnight(self):
        self.assertFalse(self.trip.crosses_midnight)

    def test_a_late_trip_crosses_midnight(self):
        late = Trip.from_times("t", "p", "s", ["23:50", "24:20"])
        self.assertTrue(late.crosses_midnight)

    def test_a_late_trip_keeps_its_order(self):
        late = Trip.from_times("t", "p", "s", ["23:50", "24:20"])
        self.assertGreater(late.end_time, SECONDS_PER_DAY)

    def test_shifting_moves_every_time(self):
        moved = self.trip.shifted(3600)
        self.assertEqual(moved.start_time, self.trip.start_time + 3600)
        self.assertEqual(moved.duration, self.trip.duration)

    def test_shifting_keeps_the_identifier(self):
        self.assertEqual(self.trip.shifted(60).trip_id, "t1")

    def test_renaming_keeps_the_times(self):
        renamed = self.trip.renamed("t2")
        self.assertEqual(renamed.trip_id, "t2")
        self.assertEqual(renamed.departures, self.trip.departures)

    def test_renders_with_its_span(self):
        self.assertEqual(str(self.trip), "t1 08:00:00-08:12:00")


class CallTest(unittest.TestCase):
    def setUp(self):
        self.trip = Trip.from_times("t", "p", "s", ["08:00", ("08:05", "08:06"), "08:12"])

    def test_pairs_stops_with_times(self):
        calls = self.trip.calls(("a", "b", "c"))
        self.assertEqual([call.stop_id for call in calls], ["a", "b", "c"])

    def test_a_call_knows_its_position(self):
        self.assertEqual(self.trip.calls(("a", "b", "c"))[2].index, 2)

    def test_a_call_knows_its_dwell(self):
        self.assertEqual(self.trip.calls(("a", "b", "c"))[1].dwell, 60)

    def test_the_wrong_number_of_stops_raises(self):
        with self.assertRaises(NetworkError):
            self.trip.calls(("a", "b"))

    def test_a_call_renders_time_and_stop(self):
        self.assertEqual(str(StopCall("a", 0, 60, 0)), "00:01:00 a")


if __name__ == "__main__":
    unittest.main()
