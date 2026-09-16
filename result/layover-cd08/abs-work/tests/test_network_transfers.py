"""Transfers between stops and the closure that chains them."""

import unittest

from layover.errors import NetworkError
from layover.network.transfers import Transfer, TransferKind, closure


class TransferKindTest(unittest.TestCase):
    def test_reads_a_name(self):
        self.assertIs(TransferKind.parse("walk"), TransferKind.WALK)

    def test_reads_a_dashed_name(self):
        self.assertIs(TransferKind.parse("in-station"), TransferKind.IN_STATION)

    def test_reads_an_underscored_name(self):
        self.assertIs(TransferKind.parse("stay_seated"), TransferKind.STAY_SEATED)

    def test_passes_a_kind_through(self):
        self.assertIs(TransferKind.parse(TransferKind.WALK), TransferKind.WALK)

    def test_rejects_nonsense(self):
        with self.assertRaises(NetworkError):
            TransferKind.parse("teleport")

    def test_renders_as_its_name(self):
        self.assertEqual(str(TransferKind.IN_STATION), "in-station")


class TransferTest(unittest.TestCase):
    def setUp(self):
        self.transfer = Transfer("a", "b", 120, distance_metres=90)

    def test_keeps_its_stops(self):
        self.assertEqual(self.transfer.pair, ("a", "b"))

    def test_trims_the_stops(self):
        self.assertEqual(Transfer(" a ", "b", 60).from_stop, "a")

    def test_defaults_to_a_walk(self):
        self.assertIs(Transfer("a", "b", 60).kind, TransferKind.WALK)

    def test_rejects_an_empty_stop(self):
        with self.assertRaises(NetworkError):
            Transfer("", "b", 60)

    def test_rejects_a_transfer_to_itself(self):
        with self.assertRaises(NetworkError):
            Transfer("a", "a", 60)

    def test_rejects_negative_time(self):
        with self.assertRaises(NetworkError):
            Transfer("a", "b", -1)

    def test_rejects_a_negative_distance(self):
        with self.assertRaises(NetworkError):
            Transfer("a", "b", 60, distance_metres=-5)

    def test_no_time_at_all_is_allowed(self):
        self.assertEqual(Transfer("a", "b", 0).seconds, 0)

    def test_reversing_swaps_the_stops(self):
        self.assertEqual(self.transfer.reversed().pair, ("b", "a"))

    def test_reversing_keeps_the_time(self):
        self.assertEqual(self.transfer.reversed().seconds, 120)

    def test_reversing_twice_comes_back(self):
        self.assertEqual(self.transfer.reversed().reversed(), self.transfer)

    def test_changing_the_time(self):
        self.assertEqual(self.transfer.with_seconds(300).seconds, 300)

    def test_changing_the_time_keeps_the_distance(self):
        self.assertEqual(self.transfer.with_seconds(300).distance_metres, 90)

    def test_renders_readably(self):
        self.assertEqual(str(self.transfer), "a to b in 2m")

    def test_is_hashable(self):
        self.assertEqual(len({Transfer("a", "b", 60), Transfer("a", "b", 60)}), 1)


class ClosureTest(unittest.TestCase):
    def test_a_single_transfer_comes_back(self):
        self.assertEqual(len(closure([Transfer("a", "b", 60)])), 1)

    def test_two_hops_become_three_pairs(self):
        found = closure([Transfer("a", "b", 120), Transfer("b", "c", 90)])
        self.assertEqual([transfer.pair for transfer in found], [("a", "b"), ("a", "c"), ("b", "c")])

    def test_the_chained_time_adds_up(self):
        found = {t.pair: t.seconds for t in closure([Transfer("a", "b", 120), Transfer("b", "c", 90)])}
        self.assertEqual(found[("a", "c")], 210)

    def test_one_hop_chains_nothing(self):
        found = closure([Transfer("a", "b", 120), Transfer("b", "c", 90)], limit=1)
        self.assertEqual(len(found), 2)

    def test_a_shorter_declared_walk_wins(self):
        found = {
            t.pair: t.seconds
            for t in closure([Transfer("a", "b", 120), Transfer("b", "c", 90), Transfer("a", "c", 100)])
        }
        self.assertEqual(found[("a", "c")], 100)

    def test_the_quickest_of_two_declarations_wins(self):
        found = closure([Transfer("a", "b", 120), Transfer("a", "b", 60)])
        self.assertEqual(found[0].seconds, 60)

    def test_a_chain_never_returns_to_its_start(self):
        found = closure([Transfer("a", "b", 60), Transfer("b", "a", 60)])
        self.assertEqual(len(found), 2)

    def test_three_hops_need_the_limit_raised(self):
        transfers = [Transfer("a", "b", 60), Transfer("b", "c", 60), Transfer("c", "d", 60)]
        pairs = {transfer.pair for transfer in closure(transfers, limit=3)}
        self.assertIn(("a", "d"), pairs)

    def test_two_hops_do_not_reach_the_fourth_stop(self):
        transfers = [Transfer("a", "b", 60), Transfer("b", "c", 60), Transfer("c", "d", 60)]
        pairs = {transfer.pair for transfer in closure(transfers, limit=2)}
        self.assertNotIn(("a", "d"), pairs)

    def test_the_result_is_sorted(self):
        found = closure([Transfer("b", "c", 90), Transfer("a", "b", 120)])
        self.assertEqual([t.pair for t in found], sorted(t.pair for t in found))

    def test_nothing_in_nothing_out(self):
        self.assertEqual(closure([]), ())

    def test_rejects_a_limit_below_one(self):
        with self.assertRaises(NetworkError):
            closure([Transfer("a", "b", 60)], limit=0)

    def test_a_chained_transfer_is_a_walk(self):
        found = {t.pair: t for t in closure([Transfer("a", "b", 60, "in-station"), Transfer("b", "c", 60, "in-station")])}
        self.assertIs(found[("a", "c")].kind, TransferKind.WALK)


if __name__ == "__main__":
    unittest.main()
