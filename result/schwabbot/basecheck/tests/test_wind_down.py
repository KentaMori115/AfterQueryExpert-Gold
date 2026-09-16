"""The end of a short premium session: what the bot does with a live entry."""

from datetime import datetime

from django.test import SimpleTestCase

from Engine import offline
from Engine.bot.bot02_engine import Bot02Engine
from Engine.straddle import buyback_order, closing_legs, exit_plan


def option_leg(instruction, symbol, quantity=1):
    return {
        'instruction': instruction,
        'quantity': quantity,
        'instrument': {'symbol': symbol, 'assetType': 'OPTION'},
    }


def profit_target(*symbols):
    return {
        'orderType': 'NET_DEBIT',
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'SINGLE',
        'orderLegCollection': [
            option_leg('BUY_TO_CLOSE', symbol) for symbol in symbols
        ],
    }


def straddle_entry(quantity=1, with_target=True):
    entry = {
        'orderType': 'NET_CREDIT',
        'price': 9.45,
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'TRIGGER',
        'orderLegCollection': [
            option_leg('SELL_TO_OPEN', 'XSP   260326C00600000', quantity),
            option_leg('SELL_TO_OPEN', 'XSP   260326P00600000', quantity),
        ],
    }
    if with_target:
        entry['childOrderStrategies'] = [
            profit_target('XSP   260326C00600000', 'XSP   260326P00600000')
        ]
    return entry


def defined_risk_entry(quantity=1):
    return {
        'orderType': 'NET_CREDIT',
        'price': 6.10,
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'TRIGGER',
        'orderLegCollection': [
            option_leg('SELL_TO_OPEN', 'XSP   260326C00600000', quantity),
            option_leg('SELL_TO_OPEN', 'XSP   260326P00600000', quantity),
            option_leg('BUY_TO_OPEN', 'XSP   260326C00606000', quantity),
            option_leg('BUY_TO_OPEN', 'XSP   260326P00594000', quantity),
        ],
        'childOrderStrategies': [
            profit_target('XSP   260326C00600000', 'XSP   260326P00600000')
        ],
    }


def quotes(**by_symbol):
    return {
        symbol: {'quote': {'bidPrice': bid, 'askPrice': ask}}
        for symbol, (bid, ask) in by_symbol.items()
    }


def straddle_quotes(call_bid, call_ask, put_bid, put_ask):
    return {
        'XSP   260326C00600000': {
            'quote': {'bidPrice': call_bid, 'askPrice': call_ask}},
        'XSP   260326P00600000': {
            'quote': {'bidPrice': put_bid, 'askPrice': put_ask}},
    }


def wing_quotes(call_bid, call_ask, put_bid, put_ask):
    return {
        'XSP   260326C00606000': {
            'quote': {'bidPrice': call_bid, 'askPrice': call_ask}},
        'XSP   260326P00594000': {
            'quote': {'bidPrice': put_bid, 'askPrice': put_ask}},
    }


class ClosingLegTests(SimpleTestCase):
    def test_short_legs_are_bought_back(self):
        legs = closing_legs(straddle_entry())
        self.assertEqual(
            [leg['instruction'] for leg in legs],
            ['BUY_TO_CLOSE', 'BUY_TO_CLOSE'],
        )

    def test_long_legs_are_sold_back(self):
        legs = closing_legs(defined_risk_entry())
        self.assertEqual(
            [leg['instruction'] for leg in legs],
            ['BUY_TO_CLOSE', 'BUY_TO_CLOSE', 'SELL_TO_CLOSE', 'SELL_TO_CLOSE'],
        )

    def test_legs_keep_the_order_the_entry_made_them(self):
        legs = closing_legs(defined_risk_entry())
        self.assertEqual(
            [leg['instrument']['symbol'] for leg in legs],
            [
                'XSP   260326C00600000',
                'XSP   260326P00600000',
                'XSP   260326C00606000',
                'XSP   260326P00594000',
            ],
        )

    def test_leg_quantity_comes_from_the_entry(self):
        legs = closing_legs(straddle_entry(quantity=7))
        self.assertEqual([leg['quantity'] for leg in legs], [7, 7])

    def test_instrument_travels_unchanged(self):
        legs = closing_legs(straddle_entry())
        self.assertEqual(
            legs[0]['instrument'],
            {'symbol': 'XSP   260326C00600000', 'assetType': 'OPTION'},
        )

    def test_the_target_is_not_part_of_the_position(self):
        entry = straddle_entry()
        entry['childOrderStrategies'][0]['orderLegCollection'].append(
            option_leg('BUY_TO_CLOSE', 'XSP   260326C00610000'))
        self.assertEqual(len(closing_legs(entry)), 2)

    def test_an_already_closing_leg_is_refused(self):
        entry = straddle_entry()
        entry['orderLegCollection'][0]['instruction'] = 'BUY_TO_CLOSE'
        self.assertIsNone(closing_legs(entry))

    def test_a_leg_without_a_quantity_is_refused(self):
        entry = straddle_entry()
        del entry['orderLegCollection'][1]['quantity']
        self.assertIsNone(closing_legs(entry))

    def test_an_entry_without_legs_is_refused(self):
        self.assertIsNone(closing_legs({'orderType': 'NET_CREDIT'}))

    def test_something_that_is_not_an_order_is_refused(self):
        self.assertIsNone(closing_legs(None))


class BuybackPriceTests(SimpleTestCase):
    def test_short_legs_are_bought_back_at_the_ask(self):
        order = buyback_order(
            straddle_entry(),
            straddle_quotes(4.10, 4.30, 5.00, 5.14),
            '$XSP',
        )
        self.assertEqual(order['orderType'], 'NET_DEBIT')
        self.assertEqual(order['price'], 9.44)

    def test_a_debit_rounds_down_to_the_tick(self):
        order = buyback_order(
            straddle_entry(),
            straddle_quotes(4.10, 4.30, 5.00, 5.14),
            '$SPX',
        )
        self.assertEqual(order['price'], 9.40)

    def test_a_price_already_on_the_grid_does_not_move(self):
        order = buyback_order(
            straddle_entry(),
            straddle_quotes(0.10, 0.14, 0.11, 0.15),
            '$XSP',
        )
        self.assertEqual(order['price'], 0.29)

    def test_a_wide_grid_price_already_on_the_grid_does_not_move(self):
        order = buyback_order(
            straddle_entry(),
            straddle_quotes(0.50, 0.55, 0.55, 0.60),
            '$SPX',
        )
        self.assertEqual(order['price'], 1.15)

    def test_long_legs_are_sold_back_at_the_bid(self):
        market = straddle_quotes(0.90, 1.00, 0.90, 1.00)
        market.update(wing_quotes(2.80, 2.90, 2.72, 2.80))
        order = buyback_order(defined_risk_entry(), market, '$SPX')
        self.assertEqual(order['orderType'], 'NET_CREDIT')

    def test_a_credit_rounds_up_to_the_tick(self):
        market = straddle_quotes(0.90, 1.00, 0.90, 1.00)
        market.update(wing_quotes(2.80, 2.90, 2.72, 2.80))
        order = buyback_order(defined_risk_entry(), market, '$SPX')
        self.assertEqual(order['price'], 3.55)

    def test_a_limit_order_carries_the_house_terms(self):
        order = buyback_order(
            straddle_entry(),
            straddle_quotes(4.10, 4.30, 5.00, 5.14),
            '$XSP',
        )
        self.assertEqual(order['session'], 'NORMAL')
        self.assertEqual(order['duration'], 'DAY')
        self.assertEqual(order['orderStrategyType'], 'SINGLE')

    def test_an_unquotable_leg_goes_to_market(self):
        market = straddle_quotes(4.10, 4.30, 5.00, 5.14)
        del market['XSP   260326P00600000']
        order = buyback_order(straddle_entry(), market, '$XSP')
        self.assertEqual(order['orderType'], 'MARKET')

    def test_a_market_order_carries_no_price(self):
        order = buyback_order(straddle_entry(), {}, '$XSP')
        self.assertNotIn('price', order)

    def test_a_missing_side_of_the_market_is_not_half_a_price(self):
        market = straddle_quotes(4.10, 4.30, 5.00, 5.14)
        del market['XSP   260326C00600000']['quote']['askPrice']
        order = buyback_order(straddle_entry(), market, '$XSP')
        self.assertEqual(order['orderType'], 'MARKET')

    def test_a_market_order_still_closes_every_leg(self):
        order = buyback_order(defined_risk_entry(quantity=4), {}, '$XSP')
        self.assertEqual(len(order['orderLegCollection']), 4)
        self.assertEqual(
            [leg['quantity'] for leg in order['orderLegCollection']],
            [4, 4, 4, 4],
        )

    def test_an_entry_that_cannot_be_undone_has_no_order(self):
        self.assertIsNone(buyback_order({'orderLegCollection': []}, {}, '$XSP'))


class ExitPlanTests(SimpleTestCase):
    def setUp(self):
        self.market = straddle_quotes(4.10, 4.30, 5.00, 5.14)

    def test_a_session_with_room_left_holds(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 11)
        self.assertEqual(plan['action'], 'hold')

    def test_holding_pulls_nothing_and_sends_nothing(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 240)
        self.assertFalse(plan['cancel_child'])
        self.assertIsNone(plan['order'])

    def test_the_cushion_itself_already_closes(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 10)
        self.assertEqual(plan['action'], 'close')

    def test_closing_inside_the_cushion_names_a_price(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 3)
        self.assertEqual(plan['order']['orderType'], 'NET_DEBIT')
        self.assertEqual(plan['order']['price'], 9.44)

    def test_a_session_that_has_run_out_goes_to_market(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 0)
        self.assertEqual(plan['order']['orderType'], 'MARKET')

    def test_past_the_bell_still_goes_to_market(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', -4)
        self.assertEqual(plan['action'], 'close')
        self.assertNotIn('price', plan['order'])

    def test_closing_a_defined_risk_structure_can_pay(self):
        market = straddle_quotes(0.90, 1.00, 0.90, 1.00)
        market.update(wing_quotes(2.80, 2.90, 2.72, 2.80))
        plan = exit_plan(defined_risk_entry(), market, '$SPX', 6)
        self.assertEqual(plan['action'], 'close')
        self.assertEqual(plan['order']['orderType'], 'NET_CREDIT')
        self.assertEqual(plan['order']['price'], 3.55)

    def test_a_working_target_is_pulled_first(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 2)
        self.assertTrue(plan['cancel_child'])

    def test_an_entry_that_carried_no_target_pulls_nothing(self):
        plan = exit_plan(
            straddle_entry(with_target=False), self.market, '$XSP', 2)
        self.assertFalse(plan['cancel_child'])

    def test_an_unreadable_clock_holds(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', None)
        self.assertEqual(plan['action'], 'hold')

    def test_an_entry_that_cannot_be_undone_has_no_plan(self):
        entry = straddle_entry()
        entry['orderLegCollection'][0]['instruction'] = 'BUY_TO_CLOSE'
        self.assertIsNone(exit_plan(entry, self.market, '$XSP', 1))

    def test_a_plan_says_only_these_three_things(self):
        plan = exit_plan(straddle_entry(), self.market, '$XSP', 1)
        self.assertEqual(sorted(plan.keys()), ['action', 'cancel_child', 'order'])


def one_group(users, lot_sizes, symbol='$XSP', payload=None):
    return {
        '%s-Straddle' % symbol: {
            'users': list(users),
            'payload': payload if payload is not None else straddle_entry(),
            'lot_sizes': list(lot_sizes),
            'spread_diff': None,
        }
    }


def engine_holding(groups, order_result=None):
    engine = Bot02Engine()
    users = [name for group in groups.values() for name in group['users']]
    engine.access_token_info = dict.fromkeys(users, 'offline-access-token')
    engine.account_info = dict.fromkeys(users, 'offline-account')
    engine.order_result_dict = dict(order_result or {})
    engine.remember_live_entries(groups)
    return engine


class EngineMemoryTests(SimpleTestCase):
    def test_every_user_who_traded_is_remembered(self):
        engine = engine_holding(one_group(['ada', 'bo'], [2, 5]))
        self.assertEqual(sorted(engine.live_entries.keys()), ['ada', 'bo'])

    def test_each_user_keeps_their_own_size(self):
        engine = engine_holding(one_group(['ada', 'bo'], [2, 5]))
        legs = engine.live_entries['bo']['payload']['orderLegCollection']
        self.assertEqual([leg['quantity'] for leg in legs], [5, 5])

    def test_one_user_size_does_not_reach_another(self):
        engine = engine_holding(one_group(['ada', 'bo'], [2, 5]))
        legs = engine.live_entries['ada']['payload']['orderLegCollection']
        self.assertEqual(legs[0]['quantity'], 2)

    def test_a_user_who_was_sized_out_is_not_held(self):
        engine = engine_holding(one_group(['ada', 'bo'], [0, 5]))
        self.assertEqual(list(engine.live_entries.keys()), ['bo'])

    def test_a_negative_size_is_not_held_either(self):
        engine = engine_holding(one_group(['ada', 'bo'], [-1, 5]))
        self.assertEqual(list(engine.live_entries.keys()), ['bo'])

    def test_the_broker_id_travels_with_the_entry(self):
        engine = engine_holding(
            one_group(['ada', 'bo'], [2, 5]),
            {'ada': ['OFFLINE-1001', 'FILLED', 'offline fill']})
        self.assertEqual(engine.live_entries['ada']['order_id'], 'OFFLINE-1001')

    def test_an_order_that_never_got_an_id_is_still_held(self):
        engine = engine_holding(one_group(['ada', 'bo'], [2, 5]))
        self.assertIsNone(engine.live_entries['bo']['order_id'])

    def test_the_traded_symbol_comes_off_the_group(self):
        engine = engine_holding(one_group(['ada', 'bo'], [2, 5]))
        self.assertEqual(engine.live_entries['ada']['trading_symbol'], '$XSP')
        self.assertEqual(engine.live_entries['bo']['trading_symbol'], '$XSP')

    def test_a_second_group_keeps_its_own_symbol(self):
        groups = one_group(['ada'], [2])
        groups.update(one_group(['cy'], [4], symbol='$SPX'))
        engine = engine_holding(groups)
        self.assertEqual(engine.live_entries['cy']['trading_symbol'], '$SPX')
        legs = engine.live_entries['cy']['payload']['orderLegCollection']
        self.assertEqual(legs[0]['quantity'], 4)

    def test_nothing_traded_is_nothing_held(self):
        self.assertEqual(engine_holding({}).live_entries, {})


class EngineCheckExitTests(SimpleTestCase):
    def setUp(self):
        self.who = 'trader-%s' % self._testMethodName
        self.entry_id = offline.record_paper_order(straddle_entry(), self.who)
        self.target_id = offline.paper_child_orders(self.entry_id)[0]['order_id']
        self.engine = engine_holding(
            one_group([self.who], [2]),
            {self.who: [self.entry_id, 'FILLED', 'offline fill']})
        self.early = datetime(2026, 3, 26, 12, 0)
        self.late = datetime(2026, 3, 26, 15, 55)

    def test_a_session_with_room_left_holds(self):
        plans = self.engine.check_exit(self.early)
        self.assertEqual(plans[self.who]['action'], 'hold')

    def test_holding_keeps_the_entry(self):
        self.engine.check_exit(self.early)
        self.assertIn(self.who, self.engine.live_entries)

    def test_holding_leaves_the_target_working(self):
        self.engine.check_exit(self.early)
        self.assertEqual(offline.paper_order_status(self.target_id)[0], 'WORKING')

    def test_holding_sends_nothing(self):
        self.engine.check_exit(self.early)
        self.assertEqual(len(offline.paper_order_summaries(self.who)), 1)

    def test_the_bell_closes_what_is_held(self):
        plans = self.engine.check_exit(self.late)
        self.assertEqual(plans[self.who]['action'], 'close')

    def test_closing_pulls_the_target(self):
        self.engine.check_exit(self.late)
        self.assertEqual(offline.paper_order_status(self.target_id)[0], 'CANCELED')

    def test_closing_sends_an_order_for_the_structure(self):
        self.engine.check_exit(self.late)
        self.assertEqual(len(offline.paper_order_summaries(self.who)), 2)

    def test_a_closed_entry_is_no_longer_held(self):
        self.engine.check_exit(self.late)
        self.assertNotIn(self.who, self.engine.live_entries)

    def test_a_bot_holding_nothing_plans_nothing(self):
        self.assertEqual(engine_holding({}).check_exit(self.late), {})
