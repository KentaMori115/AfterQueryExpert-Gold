"""Each check, on a feed built to trip it and one built not to."""

import unittest
from datetime import date

from layover.fares import FareProduct, FareRule, FareTable
from layover.feed import FeedContents
from layover.money import Money
from layover.network import NetworkBuilder, Transfer
from layover.services import ServiceCalendar, ServiceRegistry
from layover.validate import check_named, check_names, describe_checks, validate
from tests.support import JULY, line_network, services


def contents(network=None, registry=None, fares=None):
    return FeedContents(network or line_network(), registry or services(), fares, "test")


def fired(name, given):
    return tuple(check_named(name)(given))


class RegistryTest(unittest.TestCase):
    def test_every_check_has_a_note(self):
        for name, note in describe_checks():
            with self.subTest(name=name):
                self.assertTrue(note)

    def test_names_are_sorted(self):
        self.assertEqual(list(check_names()), sorted(check_names()))

    def test_an_unknown_check_raises(self):
        with self.assertRaises(KeyError):
            check_named("no-such-check")

    def test_there_are_a_good_number_of_checks(self):
        self.assertGreaterEqual(len(check_names()), 15)


class StopCheckTest(unittest.TestCase):
    def test_an_unused_stop_is_reported(self):
        builder = NetworkBuilder.from_network(line_network())
        builder.stop("lonely", "Lonely", "52.4", "13.4")
        self.assertEqual(len(fired("unused-stops", contents(builder.build()))), 1)

    def test_a_used_stop_is_not(self):
        self.assertEqual(fired("unused-stops", contents()), ())

    def test_a_stop_with_no_position_is_reported(self):
        builder = NetworkBuilder.from_network(line_network())
        builder.stop("blind", "Blind")
        found = fired("missing-positions", contents(builder.build()))
        self.assertEqual(found[0].subject, "blind")

    def test_positioned_stops_are_not(self):
        self.assertEqual(fired("missing-positions", contents()), ())


class PatternCheckTest(unittest.TestCase):
    def test_a_pattern_with_no_trips_is_reported(self):
        builder = NetworkBuilder.from_network(line_network())
        builder.pattern("x-empty", "x", ["a", "b"])
        found = fired("empty-patterns", contents(builder.build()))
        self.assertEqual(found[0].subject, "x-empty")

    def test_a_running_pattern_is_not(self):
        self.assertEqual(fired("empty-patterns", contents()), ())

    def test_overtaking_is_reported(self):
        builder = NetworkBuilder("overtake")
        builder.stop("a", "A", "52.5", "13.3")
        builder.stop("b", "B", "52.5", "13.4")
        builder.route("r", "R")
        builder.pattern("r-out", "r", ["a", "b"])
        builder.trip("slow", "r-out", "weekday", ["08:00", "09:00"])
        builder.trip("fast", "r-out", "weekday", ["08:10", "08:30"])
        found = fired("overtaking-trips", contents(builder.build()))
        self.assertEqual(found[0].subject, "r-out")

    def test_an_orderly_pattern_is_not(self):
        self.assertEqual(fired("overtaking-trips", contents()), ())


class TripCheckTest(unittest.TestCase):
    def build(self, times, second=None):
        builder = NetworkBuilder("trips")
        builder.stop("a", "A", "52.500", "13.300")
        builder.stop("b", "B", "52.500", "13.320")
        builder.route("r", "R")
        builder.pattern("r-out", "r", ["a", "b"])
        builder.trip("t1", "r-out", "weekday", times)
        if second is not None:
            builder.trip("t2", "r-out", "weekday", second)
        return contents(builder.build())

    def test_a_hop_that_takes_no_time_is_reported(self):
        found = fired("standing-hops", self.build([("08:00", "08:00"), "08:00"]))
        self.assertEqual(found[0].subject, "t1")

    def test_an_ordinary_hop_is_not(self):
        self.assertEqual(fired("standing-hops", self.build(["08:00", "08:10"])), ())

    def test_an_impossible_speed_is_reported(self):
        found = fired("fast-hops", self.build([("08:00", "08:00"), "08:00:01"]))
        self.assertEqual(found[0].subject, "t1")

    def test_a_sensible_speed_is_not(self):
        self.assertEqual(fired("fast-hops", self.build(["08:00", "08:10"])), ())

    def test_a_long_stand_is_reported(self):
        found = fired("long-dwells", self.build([("08:00", "08:30"), "08:40"]))
        self.assertEqual(found[0].subject, "t1")

    def test_a_short_stand_is_not(self):
        self.assertEqual(fired("long-dwells", self.build([("08:00", "08:01"), "08:10"])), ())

    def test_a_duplicated_trip_is_reported(self):
        found = fired("duplicate-trips", self.build(["08:00", "08:10"], ["08:00", "08:10"]))
        self.assertEqual(len(found), 1)

    def test_two_different_trips_are_not(self):
        self.assertEqual(
            fired("duplicate-trips", self.build(["08:00", "08:10"], ["09:00", "09:10"])), ()
        )


class ServiceCheckTest(unittest.TestCase):
    def test_a_trip_under_an_unknown_service_is_an_error(self):
        registry = ServiceRegistry([ServiceCalendar.weekly("weekday", ["mon"], JULY)])
        found = fired("unknown-services", contents(registry=registry))
        self.assertTrue(found[0].is_error)

    def test_known_services_are_not_reported(self):
        self.assertEqual(fired("unknown-services", contents()), ())

    def test_an_empty_calendar_is_reported(self):
        calendar = ServiceCalendar.weekly("thin", ["mon"], JULY)
        drained = calendar.with_removed(calendar.active_dates())
        registry = ServiceRegistry(list(services()) + [drained])
        found = fired("empty-calendars", contents(registry=registry))
        self.assertEqual(found[0].subject, "thin")

    def test_a_full_calendar_is_not(self):
        self.assertEqual(fired("empty-calendars", contents()), ())

    def test_two_identical_calendars_are_reported(self):
        registry = ServiceRegistry(
            list(services())
            + [ServiceCalendar.weekly("weekday2", ["mon", "tue", "wed", "thu", "fri"], JULY)]
        )
        found = fired("duplicate-calendars", contents(registry=registry))
        self.assertEqual(len(found), 1)

    def test_distinct_calendars_are_not(self):
        self.assertEqual(fired("duplicate-calendars", contents()), ())

    def test_a_calendar_nothing_runs_under_is_reported(self):
        registry = ServiceRegistry(
            list(services()) + [ServiceCalendar.weekly("ghost", ["mon"], JULY)]
        )
        found = fired("unused-services", contents(registry=registry))
        self.assertEqual(found[0].subject, "ghost")

    def test_used_calendars_are_not(self):
        self.assertEqual(fired("unused-services", contents()), ())

    def test_a_gap_in_the_service_is_reported(self):
        registry = ServiceRegistry(
            [
                ServiceCalendar.on_dates("a", [date(2026, 7, 1)]),
                ServiceCalendar.on_dates("b", [date(2026, 7, 3)]),
            ]
        )
        found = fired("service-gaps", contents(registry=registry))
        self.assertEqual(found[0].subject, "2026-07-02")

    def test_a_continuous_service_is_not(self):
        registry = ServiceRegistry([ServiceCalendar.weekly("daily", range(7), JULY)])
        self.assertEqual(fired("service-gaps", contents(registry=registry)), ())


class TransferCheckTest(unittest.TestCase):
    def build(self, seconds):
        builder = NetworkBuilder.from_network(line_network())
        builder.add_transfer(Transfer("a", "d", seconds))
        return contents(builder.build())

    def test_a_very_long_transfer_is_reported(self):
        found = fired("long-transfers", self.build(2400))
        self.assertEqual(found[0].subject, "a to d")

    def test_an_ordinary_transfer_is_not(self):
        self.assertEqual(fired("long-transfers", self.build(300)), ())

    def test_a_transfer_faster_than_walking_is_reported(self):
        found = fired("impossible-transfers", self.build(60))
        self.assertEqual(len(found), 1)

    def test_a_realistic_transfer_is_not(self):
        self.assertEqual(fired("impossible-transfers", self.build(2400)), ())


class FareCheckTest(unittest.TestCase):
    def build(self, fares):
        return contents(fares=fares)

    def test_an_unused_product_is_reported(self):
        table = FareTable([FareProduct("day", Money("9"))], [])
        found = fired("unused-fares", self.build(table))
        self.assertEqual(found[0].subject, "day")

    def test_a_used_product_is_not(self):
        self.assertEqual(fired("unused-fares", self.build(FareTable.flat("2"))), ())

    def test_nothing_is_reported_without_fares(self):
        self.assertEqual(fired("unused-fares", contents()), ())

    def test_an_uncovered_zone_pair_is_reported(self):
        table = FareTable([FareProduct("inner", Money("2"))], [FareRule("inner", "B", "B")])
        found = fired("uncovered-fares", self.build(table))
        self.assertTrue(found)

    def test_a_flat_fare_covers_everything(self):
        self.assertEqual(fired("uncovered-fares", self.build(FareTable.flat("2"))), ())

    def test_an_unzoned_stop_is_reported_when_fares_exist(self):
        builder = NetworkBuilder.from_network(line_network())
        builder.stop("q", "Q", "52.4", "13.4")
        builder.pattern("x-q", "x", ["a", "q"])
        builder.trip("x-q-1", "x-q", "weekday", ["09:00", "09:10"])
        given = FeedContents(builder.build(), services(), FareTable.flat("2"), "test")
        found = fired("unzoned-stops", given)
        self.assertEqual(found[0].subject, "q")

    def test_zoned_stops_are_not(self):
        self.assertEqual(fired("unzoned-stops", self.build(FareTable.flat("2"))), ())


class GraphCheckTest(unittest.TestCase):
    def split(self):
        builder = NetworkBuilder("split")
        for stop_id in ("a", "b", "y", "z"):
            builder.stop(stop_id, stop_id.upper(), "52.5", "13.4", zone="A")
        builder.route("first", "F")
        builder.route("second", "S")
        builder.pattern("first-out", "first", ["a", "b"])
        builder.pattern("second-out", "second", ["y", "z"])
        builder.trip("f1", "first-out", "weekday", ["08:00", "08:10"])
        builder.trip("s1", "second-out", "weekday", ["08:00", "08:10"])
        return contents(builder.build())

    def test_a_split_feed_is_reported(self):
        found = fired("split-network", self.split())
        self.assertEqual(len(found), 1)

    def test_the_smaller_half_is_the_one_named(self):
        found = fired("split-network", self.split())
        self.assertEqual(found[0].subject, "y")

    def test_one_network_is_not_reported(self):
        self.assertEqual(fired("split-network", contents()), ())

    def test_a_dead_end_is_reported(self):
        found = fired("dead-ends", self.split())
        self.assertEqual({finding.subject for finding in found}, {"b", "z"})

    def test_the_toy_networks_only_dead_end_is_its_southern_terminus(self):
        found = fired("dead-ends", contents())
        self.assertEqual([finding.subject for finding in found], ["p"])

    def test_a_stop_with_a_way_back_is_not_a_dead_end(self):
        found = fired("dead-ends", contents())
        self.assertNotIn("d", [finding.subject for finding in found])


class WholeRunTest(unittest.TestCase):
    def test_a_clean_network_passes(self):
        self.assertTrue(validate(contents()).passed)

    def test_the_toy_network_has_no_errors(self):
        self.assertEqual(validate(contents()).errors, ())


if __name__ == "__main__":
    unittest.main()
