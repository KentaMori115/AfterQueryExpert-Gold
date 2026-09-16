"""Legs and the journeys made of them."""

import unittest

from layover.errors import PlanError
from layover.plan.leg import Journey, Leg, LegKind


def ride(from_stop="a", to_stop="c", departure=28800, arrival=29400, **changes):
    settings = dict(route_id="x", trip_id="t1", pattern_id="p1", headsign="East", intermediate=("b",))
    settings.update(changes)
    return Leg.ride(from_stop, to_stop, departure, arrival, **settings)


def journey():
    return Journey(
        (
            ride(),
            Leg.walk("c", "c2", 29400, 29520),
            ride("c2", "p", 29700, 30300, route_id="y", trip_id="t2", pattern_id="p2", headsign="South", intermediate=()),
        )
    )


class LegTest(unittest.TestCase):
    def test_a_ride_knows_its_route(self):
        self.assertEqual(ride().route_id, "x")

    def test_a_ride_is_a_ride(self):
        self.assertTrue(ride().is_ride)
        self.assertFalse(ride().is_walk)

    def test_a_walk_is_a_walk(self):
        leg = Leg.walk("a", "b", 0, 60)
        self.assertTrue(leg.is_walk)
        self.assertFalse(leg.is_ride)

    def test_duration_is_the_difference(self):
        self.assertEqual(ride().duration, 600)

    def test_a_leg_cannot_arrive_before_it_leaves(self):
        with self.assertRaises(PlanError):
            Leg.walk("a", "b", 600, 300)

    def test_a_leg_of_no_length_is_allowed(self):
        self.assertEqual(Leg.walk("a", "b", 600, 600).duration, 0)

    def test_a_ride_needs_a_route(self):
        with self.assertRaises(PlanError):
            Leg(LegKind.RIDE, "a", "b", 0, 60)

    def test_a_walk_cannot_have_a_route(self):
        with self.assertRaises(PlanError):
            Leg(LegKind.WALK, "a", "b", 0, 60, route_id="x")

    def test_the_stops_include_both_ends(self):
        self.assertEqual(ride().stops(), ("a", "b", "c"))

    def test_the_stop_count(self):
        self.assertEqual(ride().stop_count, 3)

    def test_a_walk_has_two_stops(self):
        self.assertEqual(Leg.walk("a", "b", 0, 60).stops(), ("a", "b"))

    def test_a_ride_describes_itself(self):
        self.assertEqual(ride().describe(), "08:00-08:10 x East to c")

    def test_a_walk_describes_itself(self):
        self.assertEqual(Leg.walk("a", "b", 0, 60).describe(), "00:00-00:01 walk a to b")

    def test_renders_as_its_description(self):
        self.assertEqual(str(ride()), ride().describe())

    def test_the_kind_renders_as_a_word(self):
        self.assertEqual(str(LegKind.RIDE), "ride")

    def test_is_hashable(self):
        self.assertEqual(len({ride(), ride()}), 1)


class JourneyTest(unittest.TestCase):
    def setUp(self):
        self.journey = journey()

    def test_counts_its_legs(self):
        self.assertEqual(len(self.journey), 3)

    def test_iterates_its_legs(self):
        self.assertEqual(len(list(self.journey)), 3)

    def test_indexes_its_legs(self):
        self.assertTrue(self.journey[0].is_ride)

    def test_origin_and_destination(self):
        self.assertEqual((self.journey.origin, self.journey.destination), ("a", "p"))

    def test_departure_and_arrival(self):
        self.assertEqual((self.journey.departure, self.journey.arrival), (28800, 30300))

    def test_duration(self):
        self.assertEqual(self.journey.duration, 1500)

    def test_counts_its_rides(self):
        self.assertEqual(len(self.journey.rides), 2)

    def test_counts_its_walks(self):
        self.assertEqual(len(self.journey.walks), 1)

    def test_one_change(self):
        self.assertEqual(self.journey.transfers, 1)

    def test_a_single_ride_has_no_changes(self):
        self.assertEqual(Journey((ride(),)).transfers, 0)

    def test_a_walk_only_journey_has_no_changes(self):
        self.assertEqual(Journey((Leg.walk("a", "b", 0, 60),)).transfers, 0)

    def test_time_spent_walking(self):
        self.assertEqual(self.journey.walk_seconds, 120)

    def test_time_spent_aboard(self):
        self.assertEqual(self.journey.ride_seconds, 1200)

    def test_time_spent_waiting(self):
        self.assertEqual(self.journey.wait_seconds, 180)

    def test_the_routes_in_order(self):
        self.assertEqual(self.journey.routes(), ("x", "y"))

    def test_the_stops_touched(self):
        self.assertEqual(self.journey.stops(), ("a", "b", "c", "c2", "p"))

    def test_the_interchanges(self):
        self.assertEqual(self.journey.interchanges(), ("c",))

    def test_a_journey_needs_a_leg(self):
        with self.assertRaises(PlanError):
            Journey(())

    def test_the_legs_have_to_join_up(self):
        with self.assertRaises(PlanError):
            Journey((ride(), ride("z", "p", 29700, 30300)))

    def test_a_leg_cannot_leave_before_the_last_arrives(self):
        with self.assertRaises(PlanError):
            Journey((ride(), ride("c", "p", 29000, 30300)))

    def test_describes_itself(self):
        self.assertEqual(self.journey.describe(), "08:00-08:25 (25m, 1 changes)")

    def test_the_itinerary_is_one_line_per_leg(self):
        self.assertEqual(len(self.journey.itinerary()), 3)

    def test_renders_as_its_description(self):
        self.assertEqual(str(self.journey), self.journey.describe())

    def test_is_hashable(self):
        self.assertEqual(len({journey(), journey()}), 1)


class DominanceTest(unittest.TestCase):
    def test_arriving_earlier_with_the_same_changes_dominates(self):
        early = Journey((ride(arrival=29000),))
        late = Journey((ride(arrival=29400),))
        self.assertTrue(early.dominates(late))
        self.assertFalse(late.dominates(early))

    def test_fewer_changes_at_the_same_time_dominates(self):
        direct = Journey((ride(to_stop="p", arrival=30300),))
        self.assertTrue(direct.dominates(journey()))

    def test_neither_dominates_a_genuine_tradeoff(self):
        slow_direct = Journey((ride(to_stop="p", arrival=31000),))
        self.assertFalse(slow_direct.dominates(journey()))
        self.assertFalse(journey().dominates(slow_direct))

    def test_a_journey_does_not_dominate_itself(self):
        self.assertFalse(journey().dominates(journey()))

    def test_the_sort_key_leads_with_the_arrival(self):
        self.assertEqual(journey().sort_key()[0], journey().arrival)


if __name__ == "__main__":
    unittest.main()
