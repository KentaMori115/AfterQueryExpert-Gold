"""Net quoting, and the ladder Bot1 actually works an order down."""

import copy

from django.test import SimpleTestCase

from Engine import offline
from Engine.bot.bot01_engine import Bot01Engine
from Engine.schwab_api import get_access_headers
from Engine.ladder import net_quote


# One expiry of XSP options. Every spread here is priced off this book, so a
# reader can check any expected number by hand from these five rows.
BOOK = {
    "XSP   260326C00595000": {"quote": {"bidPrice": 8.10, "askPrice": 8.30}},
    "XSP   260326C00600000": {"quote": {"bidPrice": 4.20, "askPrice": 4.40}},
    "XSP   260326C00602000": {"quote": {"bidPrice": 2.85, "askPrice": 3.05}},
    "XSP   260326C00605000": {"quote": {"bidPrice": 1.55, "askPrice": 1.71}},
    "XSP   260326C00610000": {"quote": {"bidPrice": 0.55, "askPrice": 0.65}},
    "XSP   260326P00595000": {"quote": {"bidPrice": 0.45, "askPrice": 0.55}},
    "XSP   260326P00600000": {"quote": {"bidPrice": 1.40, "askPrice": 1.56}},
    "XSP   260326P00602000": {"quote": {"bidPrice": 2.40, "askPrice": 2.56}},
    "XSP   260326P00605000": {"quote": {"bidPrice": 4.10, "askPrice": 4.30}},
    "XSP   260326P00610000": {"quote": {"bidPrice": 8.00, "askPrice": 8.20}},
}


def leg(instruction, symbol, quantity=1):
    return {
        "instruction": instruction,
        "quantity": quantity,
        "instrument": {"symbol": symbol, "assetType": "OPTION"},
    }


def package(order_type, *legs, **extra):
    body = {
        "orderType": order_type,
        "session": "NORMAL",
        "duration": "DAY",
        "orderStrategyType": "SINGLE",
        "orderLegCollection": list(legs),
    }
    body.update(extra)
    return body


STRANGLE = package(
    "NET_DEBIT",
    leg("BUY_TO_OPEN", "XSP   260326C00605000"),
    leg("BUY_TO_OPEN", "XSP   260326P00600000"),
)

IRON_FLY = package(
    "NET_DEBIT",
    leg("BUY_TO_OPEN", "XSP   260326C00602000"),
    leg("BUY_TO_OPEN", "XSP   260326P00602000"),
    leg("SELL_TO_OPEN", "XSP   260326C00610000"),
    leg("SELL_TO_OPEN", "XSP   260326P00595000"),
)

STRADDLE = package(
    "NET_CREDIT",
    leg("SELL_TO_OPEN", "XSP   260326C00602000"),
    leg("SELL_TO_OPEN", "XSP   260326P00602000"),
)

DEFINED_RISK = package(
    "NET_CREDIT",
    leg("SELL_TO_OPEN", "XSP   260326C00602000"),
    leg("SELL_TO_OPEN", "XSP   260326P00602000"),
    leg("BUY_TO_OPEN", "XSP   260326C00610000"),
    leg("BUY_TO_OPEN", "XSP   260326P00595000"),
)


class NetQuoteDebitTests(SimpleTestCase):
    """A package the account pays for is worth longs less shorts."""

    def test_two_long_legs_midpoint(self):
        # (1.55+1.71)/2 = 1.63 and (1.40+1.56)/2 = 1.48
        mid, _ = net_quote(STRANGLE, BOOK)
        self.assertAlmostEqual(mid, 3.11, places=6)

    def test_two_long_legs_far_touch_is_both_asks(self):
        _, far = net_quote(STRANGLE, BOOK)
        self.assertAlmostEqual(far, 3.27, places=6)

    def test_far_is_worse_than_mid_for_a_debit(self):
        mid, far = net_quote(STRANGLE, BOOK)
        self.assertGreater(far, mid)

    def test_short_legs_are_subtracted_at_the_midpoint(self):
        # longs (2.95 + 2.48) less shorts (0.60 + 0.50)
        mid, _ = net_quote(IRON_FLY, BOOK)
        self.assertAlmostEqual(mid, 4.33, places=6)

    def test_short_legs_are_valued_at_their_bid_in_the_far_touch(self):
        # longs at their asks (3.05 + 2.56) less shorts at their bids
        # (0.55 + 0.45), which is the worst this package can cost
        _, far = net_quote(IRON_FLY, BOOK)
        self.assertAlmostEqual(far, 4.61, places=6)

    def test_mixed_package_far_beats_using_short_asks(self):
        # 4.61 is strictly worse than valuing the shorts at their asks would
        # give, so a build that reads the wrong side of the short spread ends
        # up quoting a cheaper package than it is willing to pay for
        _, far = net_quote(IRON_FLY, BOOK)
        self.assertNotAlmostEqual(far, 4.41, places=6)


class NetQuoteCreditTests(SimpleTestCase):
    """A package the account is paid for is worth shorts less longs."""

    def test_two_short_legs_midpoint(self):
        mid, _ = net_quote(STRADDLE, BOOK)
        self.assertAlmostEqual(mid, 5.43, places=6)

    def test_two_short_legs_far_touch_is_both_bids(self):
        _, far = net_quote(STRADDLE, BOOK)
        self.assertAlmostEqual(far, 5.25, places=6)

    def test_far_is_worse_than_mid_for_a_credit(self):
        mid, far = net_quote(STRADDLE, BOOK)
        self.assertLess(far, mid)

    def test_long_wings_are_subtracted_at_the_midpoint(self):
        # shorts (2.95 + 2.48) less longs (0.60 + 0.50)
        mid, _ = net_quote(DEFINED_RISK, BOOK)
        self.assertAlmostEqual(mid, 4.33, places=6)

    def test_long_wings_are_valued_at_their_ask_in_the_far_touch(self):
        # shorts at their bids (2.85 + 2.40) less longs at their asks
        # (0.65 + 0.55), the least this package can bring in
        _, far = net_quote(DEFINED_RISK, BOOK)
        self.assertAlmostEqual(far, 4.05, places=6)

    def test_same_legs_price_differently_by_order_type(self):
        # DEFINED_RISK and IRON_FLY carry the same four symbols with the buy
        # and sell sides swapped, so the two far touches must not agree
        _, credit_far = net_quote(DEFINED_RISK, BOOK)
        _, debit_far = net_quote(IRON_FLY, BOOK)
        self.assertNotAlmostEqual(credit_far, debit_far, places=6)


class NetQuoteShapeTests(SimpleTestCase):
    """What the pair does when the payload or the book will not support it."""

    def test_missing_symbol_gives_no_price(self):
        book = dict(BOOK)
        book.pop("XSP   260326P00600000")
        self.assertEqual(net_quote(STRANGLE, book), (None, None))

    def test_leg_without_a_bid_gives_no_price(self):
        book = dict(BOOK)
        book["XSP   260326C00605000"] = {"quote": {"askPrice": 1.71}}
        self.assertEqual(net_quote(STRANGLE, book), (None, None))

    def test_leg_without_an_ask_gives_no_price(self):
        book = dict(BOOK)
        book["XSP   260326C00605000"] = {"quote": {"bidPrice": 1.55}}
        self.assertEqual(net_quote(STRANGLE, book), (None, None))

    def test_a_short_leg_without_an_ask_gives_no_price(self):
        book = dict(BOOK)
        book["XSP   260326C00602000"] = {"quote": {"bidPrice": 2.85}}
        self.assertEqual(net_quote(STRADDLE, book), (None, None))

    def test_a_short_leg_without_a_bid_gives_no_price(self):
        book = dict(BOOK)
        book["XSP   260326C00602000"] = {"quote": {"askPrice": 3.05}}
        self.assertEqual(net_quote(STRADDLE, book), (None, None))

    def test_empty_leg_collection_gives_no_price(self):
        self.assertEqual(net_quote(package("NET_DEBIT"), BOOK), (None, None))

    def test_empty_book_gives_no_price(self):
        self.assertEqual(net_quote(STRANGLE, {}), (None, None))

    def test_sell_to_close_counts_as_a_short_leg(self):
        closing = package(
            "NET_CREDIT",
            leg("SELL_TO_CLOSE", "XSP   260326C00602000"),
            leg("SELL_TO_CLOSE", "XSP   260326P00602000"),
        )
        self.assertEqual(net_quote(closing, BOOK), net_quote(STRADDLE, BOOK))


COMBO = package(
    "NET_DEBIT",
    leg("BUY_TO_OPEN", "XSP   260326C00602000"),
    leg("BUY_TO_OPEN", "XSP   260326P00602000"),
    leg("SELL_TO_OPEN", "XSP   260326C00610000"),
)

WIDE_STRANGLE = package(
    "NET_DEBIT",
    leg("BUY_TO_OPEN", "XSP   260326C00610000"),
    leg("BUY_TO_OPEN", "XSP   260326P00595000"),
)


class NetQuoteComboTests(SimpleTestCase):
    """Three legs price the same way two do: longs less shorts."""

    def test_combo_midpoint(self):
        # longs 2.95 + 2.48, short 0.60
        mid, _ = net_quote(COMBO, BOOK)
        self.assertAlmostEqual(mid, 4.83, places=6)

    def test_combo_far_touch(self):
        # long asks 3.05 + 2.56, short bid 0.55
        _, far = net_quote(COMBO, BOOK)
        self.assertAlmostEqual(far, 5.06, places=6)

    def test_combo_is_dearer_than_the_four_leg_package(self):
        # dropping the short put wing leaves more to pay for
        _, combo_far = net_quote(COMBO, BOOK)
        _, fly_far = net_quote(IRON_FLY, BOOK)
        self.assertGreater(combo_far, fly_far)

    def test_wide_strangle_midpoint(self):
        mid, _ = net_quote(WIDE_STRANGLE, BOOK)
        self.assertAlmostEqual(mid, 1.10, places=6)

    def test_wide_strangle_far_touch(self):
        _, far = net_quote(WIDE_STRANGLE, BOOK)
        self.assertAlmostEqual(far, 1.20, places=6)

    def test_far_and_mid_differ_by_half_the_summed_spreads(self):
        # each leg contributes half its own bid ask spread to the gap
        mid, far = net_quote(WIDE_STRANGLE, BOOK)
        self.assertAlmostEqual(far - mid, 0.10, places=6)


class NetQuoteIndependenceTests(SimpleTestCase):
    """What the price does not depend on."""

    def test_leg_order_does_not_change_the_price(self):
        reversed_legs = package(
            "NET_DEBIT",
            leg("BUY_TO_OPEN", "XSP   260326P00600000"),
            leg("BUY_TO_OPEN", "XSP   260326C00605000"),
        )
        self.assertEqual(net_quote(reversed_legs, BOOK), net_quote(STRANGLE, BOOK))

    def test_extra_symbols_in_the_book_are_ignored(self):
        book = dict(BOOK)
        book["XSP   260326C99999000"] = {"quote": {"bidPrice": 99.0, "askPrice": 99.5}}
        self.assertEqual(net_quote(STRANGLE, book), net_quote(STRANGLE, BOOK))

    def test_an_unknown_order_type_is_treated_as_a_debit(self):
        limit_order = package(
            "LIMIT",
            leg("BUY_TO_OPEN", "XSP   260326C00605000"),
            leg("BUY_TO_OPEN", "XSP   260326P00600000"),
        )
        self.assertEqual(net_quote(limit_order, BOOK), net_quote(STRANGLE, BOOK))

    def test_a_one_leg_package_prices_off_that_leg_alone(self):
        single = package("NET_DEBIT", leg("BUY_TO_OPEN", "XSP   260326C00600000"))
        mid, far = net_quote(single, BOOK)
        self.assertAlmostEqual(mid, 4.30, places=6)
        self.assertAlmostEqual(far, 4.40, places=6)

    def test_a_one_leg_short_package_prices_off_that_leg_alone(self):
        single = package("NET_CREDIT", leg("SELL_TO_OPEN", "XSP   260326C00600000"))
        mid, far = net_quote(single, BOOK)
        self.assertAlmostEqual(mid, 4.30, places=6)
        self.assertAlmostEqual(far, 4.20, places=6)


class Bot1WorkingLadderTests(SimpleTestCase):
    """What Bot1 will actually quote as it works a package down."""

    def setUp(self):
        self.engine = Bot01Engine()

    def test_bot1_walks_a_debit_package_to_the_far_touch(self):
        self.assertEqual(
            self.engine.working_ladder(STRANGLE, BOOK, "$XSP", 4),
            [3.11, 3.16, 3.21, 3.27],
        )

    def test_bot1_concedes_between_the_opening_and_final_quote(self):
        # the whole point: replacing at the opening price is not a concession
        rungs = self.engine.working_ladder(STRANGLE, BOOK, "$XSP", 4)
        self.assertNotEqual(rungs[0], rungs[-1])

    def test_bot1_opens_at_the_midpoint(self):
        rungs = self.engine.working_ladder(STRANGLE, BOOK, "$XSP", 4)
        self.assertEqual(rungs[0], 3.11)

    def test_bot1_quotes_one_rung_per_step(self):
        rungs = self.engine.working_ladder(STRANGLE, BOOK, "$XSP", 6)
        self.assertEqual(len(rungs), 6)

    def test_bot1_uses_the_nickel_grid_for_spx(self):
        self.assertEqual(
            self.engine.working_ladder(STRANGLE, BOOK, "$SPX", 4),
            [3.10, 3.15, 3.20, 3.25],
        )

    def test_bot1_holds_a_defined_risk_package_under_its_width(self):
        # the far touch is 4.61, so a width of 4.40 is what actually binds
        rungs = self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4, 4.40)
        self.assertTrue(rungs)
        for rung in rungs:
            self.assertLessEqual(rung, 4.39)

    def test_bot1_width_pulls_the_ladder_in(self):
        capped = self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4, 4.50)
        self.assertEqual(capped, [4.33, 4.38, 4.43, 4.49])

    def test_bot1_width_under_the_midpoint_pulls_the_whole_ladder_down(self):
        # the midpoint is 4.33, so a width of 4.30 sits below where the
        # package would otherwise open and every rung has to come down to it
        rungs = self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4, 4.30)
        self.assertEqual(rungs, [4.29])

    def test_bot1_never_opens_above_its_width(self):
        for width in (4.30, 4.40, 4.50):
            rungs = self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4, width)
            self.assertTrue(rungs)
            self.assertLessEqual(rungs[0], width - 0.01)

    def test_bot1_leaves_an_uncapped_package_alone(self):
        self.assertEqual(
            self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4),
            self.engine.working_ladder(IRON_FLY, BOOK, "$XSP", 4, 99.0),
        )

    def test_bot1_walks_a_credit_package_downward(self):
        rungs = self.engine.working_ladder(DEFINED_RISK, BOOK, "$XSP", 4)
        self.assertEqual(rungs, sorted(rungs, reverse=True))

    def test_bot1_quotes_nothing_when_a_leg_is_unquoted(self):
        book = dict(BOOK)
        book.pop("XSP   260326P00600000")
        self.assertEqual(self.engine.working_ladder(STRANGLE, book, "$XSP", 4), [])

    def test_bot1_single_step_stays_at_the_midpoint(self):
        self.assertEqual(self.engine.working_ladder(STRANGLE, BOOK, "$XSP", 1), [3.11])


# What the offline broker stand-in hands back for a connected account.
OFFLINE_TOKEN = "offline-access-token"
OFFLINE_ACCOUNT = "offline-account"

# The engine groups users by symbol and strategy, joined the way it joins them.
SYMBOL = "$XSP"
STRATEGY = "Terrance Trade"
TRADING_GROUP = f"{SYMBOL}-{STRATEGY}"

# Both legs are quoted in the offline book, so the engine can price this
# package end to end without a network.
FIXTURE_STRANGLE = package(
    "NET_DEBIT",
    leg("BUY_TO_OPEN", "XSP   260326C00605000"),
    leg("BUY_TO_OPEN", "XSP   260326P00600000"),
    price=0.0,
)


class Bot1ReplacementLoopTests(SimpleTestCase):
    """Bot1 working a live order down its ladder, one replacement at a time."""

    def setUp(self):
        offline._PAPER_ORDERS.clear()
        self.engine = Bot01Engine()
        self.engine.admin_info = {"ladder_steps": 4}
        self.engine.access_token_info = {"alice": OFFLINE_TOKEN}
        self.engine.account_info = {"alice": OFFLINE_ACCOUNT}
        self.engine.user_info = {"alice": {}}
        self.signal = {
            TRADING_GROUP: {
                "users": ["alice"],
                "payload": copy.deepcopy(FIXTURE_STRANGLE),
                "lot_sizes": [2],
                "spread_diff": None,
            }
        }

    def quoted(self):
        """Prices the broker actually received, oldest first."""
        return [row["payload"]["price"] for row in offline._PAPER_ORDERS.values()]

    def replace_at(self, rung_index):
        # the offline broker fills on receipt, so free the order first or the
        # engine rightly refuses to replace something already done
        offline.cancel_paper_order(self.engine.order_result_dict["alice"][0])
        return self.engine.modify_order_price(self.signal, rung_index)

    def test_opening_order_leaves_at_the_first_rung(self):
        self.engine.send_init_order(self.signal)
        self.assertEqual(self.quoted(), [3.10])

    def test_first_replacement_concedes_to_the_next_rung(self):
        self.engine.send_init_order(self.signal)
        self.replace_at(1)
        self.assertEqual(self.quoted(), [3.10, 3.15])

    def test_second_replacement_concedes_further(self):
        self.engine.send_init_order(self.signal)
        self.replace_at(1)
        self.replace_at(2)
        self.assertEqual(self.quoted(), [3.10, 3.15, 3.20])

    def test_a_replacement_never_re_quotes_the_opening_price(self):
        self.engine.send_init_order(self.signal)
        self.replace_at(1)
        prices = self.quoted()
        self.assertNotEqual(prices[-1], prices[0])

    def test_a_replacement_reports_that_it_had_a_rung(self):
        self.engine.send_init_order(self.signal)
        self.assertTrue(self.replace_at(1))

    def test_a_spent_ladder_reports_no_rung_left(self):
        self.engine.send_init_order(self.signal)
        self.assertFalse(self.replace_at(9))

    def test_a_spent_ladder_sends_no_further_order(self):
        self.engine.send_init_order(self.signal)
        self.replace_at(9)
        self.assertEqual(self.quoted(), [3.10])

    def test_replacements_carry_the_lot_size_through(self):
        self.engine.send_init_order(self.signal)
        self.replace_at(1)
        for row in offline._PAPER_ORDERS.values():
            for order_leg in row["payload"]["orderLegCollection"]:
                self.assertEqual(order_leg["quantity"], 2)

    def test_a_shorter_ladder_reaches_the_far_touch_sooner(self):
        self.engine.admin_info = {"ladder_steps": 2}
        self.engine.send_init_order(self.signal)
        self.replace_at(1)
        self.assertEqual(self.quoted(), [3.10, 3.25])


class Bot1BalanceSizingTests(SimpleTestCase):
    """Lots for a balance-sized user come off the rung the ladder ends on."""

    def run_session(self, risk_percentage, contract_type="ByAccountBalance",
                    fixed_lots="1", ladder_steps=4):
        offline._PAPER_ORDERS.clear()
        engine = Bot01Engine()
        engine.access_headers = get_access_headers("Bearer", OFFLINE_TOKEN)
        engine.access_token_info = {"alice": OFFLINE_TOKEN}
        engine.account_info = {"alice": OFFLINE_ACCOUNT}
        engine.balance_info = {"alice": 25000.0}
        engine.admin_info = {
            "vix_automatic_mode": False,
            "vix_gap_lower": True,
            "order_gap_sec": 0,
            "ladder_steps": ladder_steps,
        }
        engine.user_info = {
            "alice": {
                "sel_symbol": SYMBOL,
                "strategy_type": STRATEGY,
                "contract_type": contract_type,
                "fixed_lots": fixed_lots,
                "risk_percentage": str(risk_percentage),
            }
        }
        engine.execute_strategy()
        return [row["payload"] for row in offline._PAPER_ORDERS.values()]

    def test_the_session_opens_at_the_midpoint_rung(self):
        orders = self.run_session(10)
        self.assertEqual(orders[0]["price"], 5.42)

    def test_lots_come_from_the_last_rung_and_not_the_first(self):
        # a 1100 budget buys two lots at the 5.42 opening rung but only one at
        # the 5.60 rung this ladder ends on
        orders = self.run_session(4.4)
        self.assertEqual(orders[0]["orderLegCollection"][0]["quantity"], 1)

    def test_a_wider_budget_still_sizes_off_the_last_rung(self):
        orders = self.run_session(10)
        self.assertEqual(orders[0]["orderLegCollection"][0]["quantity"], 4)

    def test_every_leg_carries_the_same_lot_size(self):
        orders = self.run_session(10)
        sizes = {order_leg["quantity"]
                 for order_leg in orders[0]["orderLegCollection"]}
        self.assertEqual(sizes, {4})

    def test_a_one_rung_ladder_sizes_off_the_midpoint_it_never_leaves(self):
        # with a single rung there is nothing to concede, so the 5.42 opening
        # price is also the last rung and 1100 covers two lots there
        orders = self.run_session(4.4, ladder_steps=1)
        self.assertEqual(orders[0]["orderLegCollection"][0]["quantity"], 2)

    def test_the_admin_ladder_size_changes_what_the_account_buys(self):
        # same budget, same package, only the operator's rung count differs
        short = self.run_session(4.4, ladder_steps=1)
        long_ladder = self.run_session(4.4, ladder_steps=4)
        self.assertNotEqual(
            short[0]["orderLegCollection"][0]["quantity"],
            long_ladder[0]["orderLegCollection"][0]["quantity"],
        )

    def test_a_wider_ladder_reaches_the_same_far_touch(self):
        # 4 rungs and 8 rungs both end at 5.60, so both size to one lot
        orders = self.run_session(4.4, ladder_steps=8)
        self.assertEqual(orders[0]["orderLegCollection"][0]["quantity"], 1)

    def test_a_fixed_lot_user_is_not_resized_by_the_ladder(self):
        orders = self.run_session(10, contract_type="Fixed", fixed_lots="3")
        self.assertEqual(orders[0]["orderLegCollection"][0]["quantity"], 3)
