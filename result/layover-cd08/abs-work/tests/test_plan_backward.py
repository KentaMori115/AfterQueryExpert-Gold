"""The backward search: the last moment a passenger may leave and still be there."""

from datetime import date

import unittest

from layover.dates import DateRange
from layover.errors import NetworkError, PlanError
from layover.network import NetworkBuilder, Pattern
from layover.network.transfers import Transfer, TransferKind
from layover.plan import BackwardSearch, SearchOptions, plan_arriving_by
from layover.services import ServiceCalendar, ServiceRegistry
from layover.timetable import Timetable
from layover.times import parse_clock

JULY = DateRange(date(2026, 7, 1), date(2026, 7, 31))
MONDAY = date(2026, 7, 6)
TUESDAY = date(2026, 7, 7)


def services():
    """One weekday calendar covering the whole of July."""
    return ServiceRegistry(
        [ServiceCalendar.weekly("weekday", ["mon", "tue", "wed", "thu", "fri"], JULY)]
    )


def clock(text):
    """A clock time in seconds, for readability inside the expectations."""
    return parse_clock(text)


def timetable_of(network, days_back=1):
    """The network read through the weekday calendar."""
    return Timetable(network, services(), days_back)


def stepped_network():
    """One line a to d, five minutes between calls, a departure every half hour."""
    builder = NetworkBuilder("stepped")
    for stop_id in ("a", "b", "c", "d"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("main", "M", "The line", "tram")
    builder.pattern("main-east", "main", ["a", "b", "c", "d"], "East")
    for number, first in enumerate(("08:00", "08:30", "09:00")):
        start = clock(first)
        builder.trip(
            "main-%d" % number,
            "main-east",
            "weekday",
            [start, start + 300, start + 600, start + 900],
        )
    return builder.build()


def change_network():
    """Two legs with a change at r, plus a faster onward hop and a direct run.

    Route ``one`` runs p to r calling at q, route ``two`` runs r to s, route
    ``three`` runs r to s faster but only once, and route ``direct`` runs p to s
    without stopping. A journey from p to s can use one vehicle or two.
    """
    builder = NetworkBuilder("changes")
    for stop_id in ("p", "q", "r", "s"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("one", "1", "Inbound", "metro")
    builder.route("two", "2", "Onward", "bus")
    builder.route("three", "3", "Express", "bus")
    builder.route("direct", "D", "All the way", "bus")
    builder.pattern("one-east", "one", ["p", "q", "r"], "R")
    builder.pattern("two-east", "two", ["r", "s"], "S")
    builder.pattern("three-east", "three", ["r", "s"], "S")
    builder.pattern("direct-east", "direct", ["p", "s"], "S")
    for number, first in enumerate(("08:00", "08:20", "08:40")):
        start = clock(first)
        builder.trip("one-%d" % number, "one-east", "weekday", [start, start + 300, start + 600])
    for number, first in enumerate(("08:15", "08:35", "08:55")):
        start = clock(first)
        builder.trip("two-%d" % number, "two-east", "weekday", [start, start + 300])
    builder.trip("three-0", "three-east", "weekday", [clock("08:52"), clock("08:53")])
    builder.trip("direct-0", "direct-east", "weekday", [clock("08:45"), clock("09:15")])
    return builder.build()


def flag_network():
    """A line where one call sets down only and another picks up only."""
    builder = NetworkBuilder("flags")
    for stop_id in ("w", "x", "y", "z"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("flag", "F", "The line", "bus")
    builder.add_pattern(
        Pattern(
            "flag-east",
            "flag",
            ("w", "x", "y", "z"),
            pickup=(True, True, False, True),
            dropoff=(True, False, True, True),
            headsign="East",
        )
    )
    for number, first in enumerate(("08:00", "08:30")):
        start = clock(first)
        builder.trip(
            "flag-%d" % number,
            "flag-east",
            "weekday",
            [start, start + 300, start + 600, start + 900],
        )
    return builder.build()


def walk_network():
    """Two lines joined by a walk that was declared in one direction only."""
    builder = NetworkBuilder("walks")
    for stop_id in ("e", "f", "g", "k"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("left", "L", "Inbound", "tram")
    builder.route("right", "R", "Onward", "tram")
    builder.pattern("left-east", "left", ["e", "f"], "F")
    builder.pattern("right-east", "right", ["g", "k"], "K")
    builder.add_transfer(Transfer("f", "g", 120, TransferKind.WALK))
    for number, first in enumerate(("08:00", "08:20")):
        start = clock(first)
        builder.trip("left-%d" % number, "left-east", "weekday", [start, start + 300])
    for number, first in enumerate(("08:10", "08:30")):
        start = clock(first)
        builder.trip("right-%d" % number, "right-east", "weekday", [start, start + 300])
    return builder.build()


def branch_network():
    """A long slow run and a short fast pair, and a feeder serving both of them.

    Route ``slowdirect`` gets from o to t on one vehicle and takes an hour.
    Route ``feeder`` runs o to m to n, and both m and n have their own onward
    hop to t, so a round working backward has two calls of the feeder to pick
    between and the answer is whichever lets a passenger leave o latest.
    """
    builder = NetworkBuilder("branch")
    for stop_id in ("o", "m", "n", "t"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("slowdirect", "SD", "The long way", "bus")
    builder.route("feeder", "FD", "The feeder", "tram")
    builder.route("mout", "MO", "Out of m", "bus")
    builder.route("nout", "NO", "Out of n", "bus")
    builder.pattern("slowdirect-east", "slowdirect", ["o", "t"], "T")
    builder.pattern("feeder-east", "feeder", ["o", "m", "n"], "N")
    builder.pattern("mout-east", "mout", ["m", "t"], "T")
    builder.pattern("nout-east", "nout", ["n", "t"], "T")
    builder.trip("slowdirect-0", "slowdirect-east", "weekday", [clock("07:00"), clock("08:00")])
    for number, first in enumerate(("08:00", "08:20", "08:40")):
        start = clock(first)
        builder.trip(
            "feeder-%d" % number, "feeder-east", "weekday", [start, start + 300, start + 600]
        )
    builder.trip("mout-0", "mout-east", "weekday", [clock("08:30"), clock("08:35")])
    builder.trip("nout-0", "nout-east", "weekday", [clock("08:12"), clock("08:20")])
    return builder.build()


def night_network():
    """A line whose last trip leaves before midnight and arrives after it."""
    builder = NetworkBuilder("night")
    for stop_id in ("n1", "n2"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("night", "N", "The night line", "bus")
    builder.pattern("night-east", "night", ["n1", "n2"], "East")
    builder.trip("night-day", "night-east", "weekday", [clock("06:00"), clock("06:20")])
    builder.trip("night-late", "night-east", "weekday", [clock("24:30"), clock("24:50")])
    return builder.build()


class LatestDepartureTest(unittest.TestCase):
    """The moment the backward search answers with."""

    def setUp(self):
        self.timetable = timetable_of(stepped_network())
        self.search = BackwardSearch(self.timetable)

    def test_the_last_trip_that_lands_in_time_is_the_one_offered(self):
        found = self.search.latest_departure("a", "d", MONDAY, clock("08:50"))
        self.assertEqual(found, clock("08:30"))

    def test_arriving_exactly_on_the_deadline_is_in_time(self):
        found = self.search.latest_departure("a", "d", MONDAY, clock("08:45"))
        self.assertEqual(found, clock("08:30"))

    def test_a_minute_short_of_the_deadline_drops_back_a_trip(self):
        found = self.search.latest_departure("a", "d", MONDAY, clock("08:44"))
        self.assertEqual(found, clock("08:00"))

    def test_nothing_arrives_in_time_at_all(self):
        self.assertIsNone(self.search.latest_departure("a", "d", MONDAY, clock("08:14")))

    def test_a_shorter_leg_of_the_same_line_has_its_own_answer(self):
        found = self.search.latest_departure("b", "c", MONDAY, clock("09:10"))
        self.assertEqual(found, clock("09:05"))

    def test_the_search_window_runs_backward_from_the_deadline(self):
        found = self.search.latest_departure("a", "d", MONDAY, clock("12:00"))
        self.assertEqual(found, clock("09:00"))

    def test_a_short_window_reaches_nothing(self):
        search = BackwardSearch(self.timetable, SearchOptions(search_window=600))
        self.assertIsNone(search.latest_departure("a", "d", MONDAY, clock("12:00")))

    def test_a_window_wide_enough_reaches_the_last_trip(self):
        search = BackwardSearch(self.timetable, SearchOptions(search_window=11 * 3600))
        found = search.latest_departure("a", "d", MONDAY, clock("12:00"))
        self.assertEqual(found, clock("09:00"))

    def test_a_day_the_service_does_not_run_answers_with_nothing(self):
        self.assertIsNone(self.search.latest_departure("a", "d", date(2026, 7, 5), clock("08:50")))

    def test_planning_to_where_you_already_are_is_refused(self):
        with self.assertRaises(PlanError):
            self.search.latest_departure("a", "a", MONDAY, clock("08:50"))

    def test_a_deadline_before_the_service_day_is_refused(self):
        with self.assertRaises(PlanError):
            self.search.latest_departure("a", "d", MONDAY, -1)

    def test_a_stop_the_network_has_never_heard_of_is_refused(self):
        with self.assertRaises(NetworkError):
            self.search.latest_departure("a", "nowhere", MONDAY, clock("08:50"))


class ReachingTest(unittest.TestCase):
    """The latest every stop may be left to get to one stop in time."""

    def setUp(self):
        self.search = BackwardSearch(timetable_of(stepped_network()))
        self.latest = self.search.reaching("d", MONDAY, clock("08:50"))

    def test_every_stop_on_the_way_is_answered_for(self):
        self.assertEqual(sorted(self.latest), ["a", "b", "c"])

    def test_the_stop_asked_about_is_left_out(self):
        self.assertNotIn("d", self.latest)

    def test_each_stop_carries_its_own_last_departure(self):
        self.assertEqual(self.latest["a"], clock("08:30"))
        self.assertEqual(self.latest["b"], clock("08:35"))
        self.assertEqual(self.latest["c"], clock("08:40"))

    def test_a_later_deadline_moves_every_stop_along(self):
        later = self.search.reaching("d", MONDAY, clock("09:20"))
        self.assertEqual(later["a"], clock("09:00"))
        self.assertEqual(later["c"], clock("09:10"))

    def test_a_deadline_nothing_can_meet_reaches_nobody(self):
        self.assertEqual(self.search.reaching("d", MONDAY, clock("08:14")), {})

    def test_a_stop_nothing_runs_from_is_not_in_the_answer(self):
        self.assertNotIn("z", self.search.reaching("d", MONDAY, clock("12:00")))


class ChangeTest(unittest.TestCase):
    """Rounds, and what a change costs going backward."""

    def setUp(self):
        self.timetable = timetable_of(change_network())

    def latest(self, by, options=None):
        """The last departure from p that reaches s by a time."""
        return BackwardSearch(self.timetable, options).latest_departure("p", "s", MONDAY, by)

    def test_two_vehicles_are_worked_back_through_in_order(self):
        self.assertEqual(self.latest(clock("08:45")), clock("08:20"))

    def test_a_change_that_needs_a_buffer_gives_up_the_later_trip(self):
        options = SearchOptions(min_transfer_seconds=360)
        self.assertEqual(self.latest(clock("08:45"), options), clock("08:00"))

    def test_a_buffer_met_exactly_keeps_the_later_trip(self):
        options = SearchOptions(min_transfer_seconds=300)
        self.assertEqual(self.latest(clock("08:45"), options), clock("08:20"))

    def test_allowing_no_change_at_all_finds_the_one_vehicle_run(self):
        options = SearchOptions(max_transfers=0)
        self.assertEqual(self.latest(clock("09:20"), options), clock("08:45"))

    def test_allowing_no_change_before_the_direct_run_finds_nothing(self):
        options = SearchOptions(max_transfers=0)
        self.assertIsNone(self.latest(clock("08:45"), options))

    def test_a_route_taken_out_of_service_is_not_used(self):
        options = SearchOptions(banned_routes=frozenset(["two", "three"]))
        self.assertEqual(self.latest(clock("09:20"), options), clock("08:45"))

    def test_a_mode_left_out_is_not_used(self):
        options = SearchOptions(allowed_modes=frozenset(["metro"]))
        self.assertIsNone(self.latest(clock("09:20"), options))

    def test_the_one_vehicle_run_wins_when_it_leaves_latest(self):
        self.assertEqual(self.latest(clock("09:20")), clock("08:45"))

    def test_the_two_vehicle_run_wins_when_the_direct_one_is_too_late(self):
        self.assertEqual(self.latest(clock("09:10")), clock("08:40"))


class FlagTest(unittest.TestCase):
    """Where a passenger may get on and off, read from the right end."""

    def setUp(self):
        self.search = BackwardSearch(timetable_of(flag_network()))

    def test_a_call_that_sets_nobody_down_cannot_end_a_journey(self):
        self.assertIsNone(self.search.latest_departure("w", "x", MONDAY, clock("09:00")))

    def test_a_call_that_picks_nobody_up_cannot_start_one(self):
        self.assertIsNone(self.search.latest_departure("y", "z", MONDAY, clock("09:00")))

    def test_the_calls_that_do_both_are_still_joined(self):
        found = self.search.latest_departure("w", "z", MONDAY, clock("09:00"))
        self.assertEqual(found, clock("08:30"))

    def test_riding_past_a_call_that_sets_nobody_down_is_allowed(self):
        found = self.search.latest_departure("w", "y", MONDAY, clock("08:45"))
        self.assertEqual(found, clock("08:30"))

    def test_a_call_that_picks_nobody_up_is_not_in_the_backward_answer(self):
        latest = self.search.reaching("z", MONDAY, clock("09:00"))
        self.assertEqual(sorted(latest), ["w", "x"])


class WalkTest(unittest.TestCase):
    """Declared transfers, walked the way they were declared."""

    def setUp(self):
        self.search = BackwardSearch(timetable_of(walk_network()))

    def test_a_walk_joins_the_two_rides(self):
        found = self.search.latest_departure("e", "k", MONDAY, clock("08:40"))
        self.assertEqual(found, clock("08:20"))

    def test_the_walk_is_not_available_the_other_way_round(self):
        self.assertIsNone(self.search.latest_departure("g", "f", MONDAY, clock("09:00")))

    def test_the_stop_the_walk_starts_at_is_reached_backward(self):
        latest = self.search.reaching("k", MONDAY, clock("08:40"))
        self.assertEqual(latest["g"], clock("08:30"))
        self.assertEqual(latest["f"], clock("08:28"))

    def test_a_walk_longer_than_the_settings_allow_is_not_walked(self):
        search = BackwardSearch(timetable_of(walk_network()), SearchOptions(max_walk_seconds=60))
        self.assertIsNone(search.latest_departure("e", "k", MONDAY, clock("08:40")))

    def test_a_walk_needs_no_buffer_between_the_rides_it_joins(self):
        options = SearchOptions(min_transfer_seconds=360)
        search = BackwardSearch(timetable_of(walk_network()), options)
        found = search.latest_departure("e", "k", MONDAY, clock("08:40"))
        self.assertEqual(found, clock("08:20"))

    def test_a_walk_does_not_count_as_a_change_of_vehicle(self):
        options = SearchOptions(max_transfers=1)
        search = BackwardSearch(timetable_of(walk_network()), options)
        found = search.latest_departure("e", "k", MONDAY, clock("08:40"))
        self.assertEqual(found, clock("08:20"))

    def test_walking_the_whole_way_needs_no_vehicle_at_all(self):
        options = SearchOptions(max_transfers=0)
        search = BackwardSearch(timetable_of(walk_network()), options)
        found = search.latest_departure("f", "g", MONDAY, clock("09:00"))
        self.assertEqual(found, clock("08:58"))


class NightTest(unittest.TestCase):
    """Service that began yesterday and is still running."""

    def setUp(self):
        self.search = BackwardSearch(timetable_of(night_network()))

    def test_a_trip_from_yesterdays_service_day_can_be_caught(self):
        found = self.search.latest_departure("n1", "n2", TUESDAY, clock("01:00"))
        self.assertEqual(found, clock("00:30"))

    def test_it_is_offered_under_the_clock_of_the_day_asked_about(self):
        latest = self.search.reaching("n2", TUESDAY, clock("01:00"))
        self.assertEqual(latest["n1"], clock("00:30"))

    def test_a_timetable_that_looks_no_days_back_never_sees_it(self):
        search = BackwardSearch(timetable_of(night_network(), days_back=0))
        self.assertIsNone(search.latest_departure("n1", "n2", TUESDAY, clock("01:00")))

    def test_the_daytime_trip_is_still_the_answer_later_on(self):
        found = self.search.latest_departure("n1", "n2", TUESDAY, clock("07:00"))
        self.assertEqual(found, clock("06:00"))


class BranchTest(unittest.TestCase):
    """Picking between two ways off one vehicle, and between two rounds."""

    def setUp(self):
        self.search = BackwardSearch(timetable_of(branch_network()))
        self.by = clock("08:40")

    def test_the_round_that_leaves_latest_is_the_one_answered_with(self):
        found = self.search.latest_departure("o", "t", MONDAY, self.by)
        self.assertEqual(found, clock("08:20"))

    def test_the_slow_single_vehicle_run_is_not_the_answer(self):
        found = self.search.latest_departure("o", "t", MONDAY, self.by)
        self.assertNotEqual(found, clock("07:00"))

    def test_every_stop_carries_the_latest_it_can_be_left(self):
        latest = self.search.reaching("t", MONDAY, self.by)
        self.assertEqual(latest["o"], clock("08:20"))
        self.assertEqual(latest["m"], clock("08:30"))
        self.assertEqual(latest["n"], clock("08:12"))

    def test_the_journey_offered_leaves_at_that_moment(self):
        journeys = self.search.plan("o", "t", MONDAY, self.by)
        self.assertEqual(journeys[0].departure, clock("08:20"))
        self.assertLessEqual(journeys[0].arrival, self.by)


class ModuleFunctionTest(unittest.TestCase):
    """The module level way in."""

    def test_it_plans_the_same_journeys_the_class_does(self):
        timetable = timetable_of(stepped_network())
        found = plan_arriving_by(timetable, "a", "d", MONDAY, clock("08:50"))
        expected = BackwardSearch(timetable).plan("a", "d", MONDAY, clock("08:50"))
        self.assertEqual(found, expected)

    def test_it_takes_the_settings_it_is_given(self):
        timetable = timetable_of(change_network())
        options = SearchOptions(max_transfers=0)
        found = plan_arriving_by(timetable, "p", "s", MONDAY, clock("08:45"), options)
        self.assertEqual(found, ())


if __name__ == "__main__":
    unittest.main()
