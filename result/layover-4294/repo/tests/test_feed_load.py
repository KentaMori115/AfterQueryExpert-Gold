"""Loading raw tables into a network, its calendars and its fares."""

import unittest
from datetime import date

from layover.errors import FeedError, LayoverError
from layover.feed import load_feed, load_with_problems
from layover.money import Money
from tests.support import feed_texts, loaded_feed, raw_feed


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()

    def test_builds_a_network(self):
        self.assertEqual(len(self.contents.network), 3)

    def test_reads_the_routes(self):
        self.assertEqual(self.contents.network.route("x").short_name, "X")

    def test_reads_the_mode(self):
        self.assertEqual(str(self.contents.network.route("x").mode), "tram")

    def test_reads_a_pattern_in_sequence_order(self):
        self.assertEqual(self.contents.network.pattern("x-east").stops, ("a", "b", "c"))

    def test_reads_the_boarding_flags(self):
        pattern = self.contents.network.pattern("x-east")
        self.assertEqual(pattern.dropoff, (False, True, True))

    def test_reads_the_trips(self):
        self.assertEqual(len(self.contents.network.trips()), 2)

    def test_reads_the_times_in_order(self):
        trip = self.contents.network.trip("t1")
        self.assertEqual(trip.departures[0], 8 * 3600 + 30)

    def test_a_missing_departure_falls_back_to_the_arrival(self):
        texts = feed_texts(
            stop_times="trip_id,sequence,arrival,departure\nt1,1,08:00:00,\nt1,2,08:05:00,\n"
                       "t2,1,08:20:00,\nt2,2,08:25:00,\n"
                       "t1,3,08:10:00,\nt2,3,08:30:00,\n"
        )
        contents = load_feed(raw_feed(**texts))
        self.assertEqual(contents.network.trip("t1").departures[0], 8 * 3600)

    def test_reads_the_transfers(self):
        self.assertEqual(self.contents.network.transfer_time("b", "c"), 120)

    def test_reads_the_calendars(self):
        self.assertEqual(self.contents.services.get("weekday").count(), 22)

    def test_reads_a_calendar_exception(self):
        self.assertFalse(self.contents.services.runs_on("weekday", date(2026, 7, 14)))

    def test_reads_the_fares(self):
        self.assertEqual(self.contents.fares.price_of("A", "B", "x"), Money("2.40"))

    def test_the_feed_knows_it_has_fares(self):
        self.assertTrue(self.contents.has_fares)

    def test_a_feed_without_fares_says_so(self):
        contents = loaded_feed(fare_products=None, fare_rules=None)
        self.assertFalse(contents.has_fares)
        self.assertIsNone(contents.fares)

    def test_reads_the_zones(self):
        self.assertEqual(self.contents.zones().zone_of("c"), "B")

    def test_counts_everything(self):
        counts = self.contents.counts()
        self.assertEqual(counts["stops"], 3)
        self.assertEqual(counts["services"], 1)

    def test_summarises(self):
        self.assertIn("3 stops", self.contents.summary())

    def test_renders_with_its_name(self):
        self.assertTrue(str(self.contents).startswith("inline: "))

    def test_a_feed_with_only_calendar_dates(self):
        contents = loaded_feed(
            calendars=None,
            calendar_dates="service_id,date,exception\nweekday,2026-07-06,add\n",
        )
        self.assertEqual(contents.services.get("weekday").count(), 1)

    def test_an_agency_is_read_when_given(self):
        contents = loaded_feed(agencies="agency_id,name,url\nop,Operator,http://x\n")
        self.assertEqual(contents.network.agency("op").name, "Operator")


class ProblemTest(unittest.TestCase):
    def problems(self, **changes):
        _, problems = load_with_problems(raw_feed(**changes))
        return problems

    def test_a_clean_feed_has_no_problems(self):
        self.assertEqual(len(self.problems()), 0)

    def test_a_stop_with_no_name(self):
        problems = self.problems(
            stops="stop_id,name,lat,lon,zone\na,,52.5,13.3,A\nb,Stop B,52.5,13.32,A\nc,Stop C,52.5,13.34,B\n"
        )
        self.assertIn("'name' is missing (stops row 1 field 'name')", problems.messages())

    def test_a_stop_with_one_coordinate(self):
        problems = self.problems(
            stops="stop_id,name,lat,lon,zone\na,Stop A,52.5,,A\nb,Stop B,52.5,13.32,A\nc,Stop C,52.5,13.34,B\n"
        )
        self.assertIn("one coordinate", problems.messages()[0])

    def test_an_unreadable_coordinate(self):
        problems = self.problems(
            stops="stop_id,name,lat,lon,zone\na,Stop A,north,13.3,A\nb,Stop B,52.5,13.32,A\nc,Stop C,52.5,13.34,B\n"
        )
        self.assertTrue(problems)

    def test_several_problems_are_all_found(self):
        problems = self.problems(
            stops="stop_id,name,lat,lon,zone\na,,52.5,13.3,A\nb,,52.5,13.32,A\nc,,52.5,13.34,B\n"
        )
        named = [message for message in problems.messages() if "'name' is missing" in message]
        self.assertEqual(len(named), 3)

    def test_a_pattern_with_no_stops(self):
        problems = self.problems(pattern_stops="pattern_id,sequence,stop_id\n")
        self.assertTrue(any("no stops" in message for message in problems.messages()))

    def test_pattern_stops_for_an_unknown_pattern(self):
        problems = self.problems(
            pattern_stops=(
                "pattern_id,sequence,stop_id,pickup,dropoff\n"
                "x-east,1,a,1,0\nx-east,2,b,1,1\nx-east,3,c,0,1\nghost,1,a,1,1\nghost,2,b,1,1\n"
            )
        )
        self.assertTrue(any("ghost" in message for message in problems.messages()))

    def test_a_repeated_sequence_number(self):
        problems = self.problems(
            pattern_stops=(
                "pattern_id,sequence,stop_id,pickup,dropoff\n"
                "x-east,1,a,1,0\nx-east,1,b,1,1\nx-east,3,c,0,1\n"
            )
        )
        self.assertTrue(any("repeats a sequence" in message for message in problems.messages()))

    def test_a_trip_with_no_times(self):
        problems = self.problems(
            trips="trip_id,pattern_id,service_id\nt1,x-east,weekday\nt2,x-east,weekday\nt3,x-east,weekday\n"
        )
        self.assertTrue(any("no times" in message for message in problems.messages()))

    def test_stop_times_for_an_unknown_trip(self):
        problems = self.problems(trips="trip_id,pattern_id,service_id\nt1,x-east,weekday\n")
        self.assertTrue(any("t2" in message for message in problems.messages()))

    def test_a_trip_whose_times_go_backwards(self):
        problems = self.problems(
            stop_times=(
                "trip_id,sequence,arrival,departure\n"
                "t1,1,08:00:00,08:00:00\nt1,2,07:00:00,07:00:00\nt1,3,08:10:00,08:10:00\n"
                "t2,1,08:20:00,08:20:00\nt2,2,08:25:00,08:25:00\nt2,3,08:30:00,08:30:00\n"
            )
        )
        self.assertTrue(any("back in time" in message for message in problems.messages()))

    def test_a_trip_with_the_wrong_number_of_times(self):
        contents, problems = load_with_problems(
            raw_feed(
                stop_times=(
                    "trip_id,sequence,arrival,departure\n"
                    "t1,1,08:00:00,08:00:00\nt1,2,08:05:00,08:05:00\n"
                    "t2,1,08:20:00,08:20:00\nt2,2,08:25:00,08:25:00\nt2,3,08:30:00,08:30:00\n"
                )
            )
        )
        self.assertIsNone(contents)
        self.assertTrue(problems)

    def test_a_transfer_to_an_unknown_stop(self):
        contents, problems = load_with_problems(
            raw_feed(transfers="from_stop,to_stop,seconds,kind\nb,ghost,120,walk\n")
        )
        self.assertIsNone(contents)

    def test_a_fare_rule_for_an_unknown_product(self):
        problems = self.problems(fare_rules="fare_id,from_zone,to_zone,route_id\nghost,,,\n")
        self.assertTrue(any("ghost" in message for message in problems.messages()))

    def test_a_repeated_stop_identifier(self):
        problems = self.problems(
            stops="stop_id,name,lat,lon,zone\na,Stop A,52.5,13.3,A\na,Again,52.5,13.32,A\nc,Stop C,52.5,13.34,B\n"
        )
        self.assertTrue(any("twice" in message for message in problems.messages()))

    def test_loading_raises_on_a_bad_feed(self):
        with self.assertRaises(LayoverError):
            load_feed(raw_feed(fare_rules="fare_id,from_zone,to_zone,route_id\nghost,,,\n"))

    def test_the_raised_error_counts_the_problems(self):
        with self.assertRaises(FeedError) as caught:
            load_feed(
                raw_feed(
                    stops="stop_id,name,lat,lon,zone\na,,52.5,13.3,A\nb,,52.5,13.32,A\nc,Stop C,52.5,13.34,B\n"
                )
            )
        self.assertIn("problems reading the feed", str(caught.exception))

    def test_a_limit_gives_up_early(self):
        with self.assertRaises(FeedError):
            load_with_problems(
                raw_feed(
                    stops="stop_id,name,lat,lon,zone\na,,52.5,13.3,A\nb,,52.5,13.32,A\nc,,52.5,13.34,B\n"
                ),
                limit=1,
            )


if __name__ == "__main__":
    unittest.main()
