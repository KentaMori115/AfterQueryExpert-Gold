"""The offline broker and the profit target riding under a gap-up entry."""

from django.test import SimpleTestCase

from Engine import offline


def profit_target(*symbols):
    return {
        'orderType': 'NET_DEBIT',
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'SINGLE',
        'orderLegCollection': [
            {
                'instruction': 'BUY_TO_CLOSE',
                'quantity': 1,
                'instrument': {'symbol': symbol, 'assetType': 'OPTION'},
            }
            for symbol in symbols
        ],
    }


def straddle_payload(targets=1):
    payload = {
        'orderType': 'NET_CREDIT',
        'price': 9.45,
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'TRIGGER',
        'orderLegCollection': [
            {
                'instruction': 'SELL_TO_OPEN',
                'quantity': 1,
                'instrument': {
                    'symbol': 'XSP   260326C00600000',
                    'assetType': 'OPTION',
                },
            },
            {
                'instruction': 'SELL_TO_OPEN',
                'quantity': 1,
                'instrument': {
                    'symbol': 'XSP   260326P00600000',
                    'assetType': 'OPTION',
                },
            },
        ],
    }
    if targets:
        payload['childOrderStrategies'] = [
            profit_target('XSP   260326C00600000', 'XSP   260326P00600000')
            for _ in range(targets)
        ]
    return payload


class PaperTargetBookingTests(SimpleTestCase):
    def setUp(self):
        # Every case books under a name of its own, so what one leaves behind
        # is invisible to the next without reaching into the broker's storage.
        self.who = 'ada-%s' % self._testMethodName
        self.other = 'bea-%s' % self._testMethodName

    def test_the_caller_hears_only_about_the_entry(self):
        order_id = offline.record_paper_order(straddle_payload(), self.who)
        child = offline.paper_child_orders(order_id)[0]
        self.assertNotEqual(child['order_id'], order_id)
        status, description = offline.paper_order_status(order_id)
        self.assertEqual(status, 'FILLED')
        self.assertEqual(description, 'offline fill')

    def test_the_target_is_booked_under_the_entry(self):
        order_id = offline.record_paper_order(straddle_payload(), self.who)
        children = offline.paper_child_orders(order_id)
        self.assertEqual(len(children), 1)

    def test_the_target_is_working_rather_than_filled(self):
        order_id = offline.record_paper_order(straddle_payload(), self.who)
        child = offline.paper_child_orders(order_id)[0]
        status, description = offline.paper_order_status(child['order_id'])
        self.assertEqual(status, 'WORKING')
        self.assertEqual(description, 'offline working')

    def test_the_target_has_an_id_of_its_own(self):
        order_id = offline.record_paper_order(straddle_payload(), self.who)
        child = offline.paper_child_orders(order_id)[0]
        self.assertNotEqual(child['order_id'], order_id)
        self.assertTrue(str(child['order_id']).startswith('OFFLINE-'))

    def test_every_target_on_an_entry_is_booked(self):
        order_id = offline.record_paper_order(straddle_payload(targets=2), self.who)
        self.assertEqual(len(offline.paper_child_orders(order_id)), 2)

    def test_targets_do_not_share_an_id(self):
        order_id = offline.record_paper_order(straddle_payload(targets=2), self.who)
        ids = {child['order_id'] for child in offline.paper_child_orders(order_id)}
        self.assertEqual(len(ids), 2)

    def test_an_entry_with_no_target_books_nothing_underneath(self):
        order_id = offline.record_paper_order(straddle_payload(targets=0), self.who)
        self.assertEqual(offline.paper_child_orders(order_id), [])

    def test_a_plain_order_books_nothing_underneath(self):
        order_id = offline.record_paper_order({'qty': 1}, self.who)
        self.assertEqual(offline.paper_child_orders(order_id), [])

    def test_two_users_targets_do_not_mix(self):
        mine = offline.record_paper_order(straddle_payload(), self.who)
        theirs = offline.record_paper_order(straddle_payload(), self.other)
        my_children = [c['order_id'] for c in offline.paper_child_orders(mine)]
        their_children = [c['order_id'] for c in offline.paper_child_orders(theirs)]
        self.assertEqual(len(my_children), 1)
        self.assertEqual(len(their_children), 1)
        self.assertNotEqual(my_children, their_children)

    def test_an_id_nobody_booked_holds_nothing(self):
        self.assertEqual(offline.paper_child_orders('OFFLINE-9999'), [])

    def test_a_third_target_is_booked_like_the_others(self):
        order_id = offline.record_paper_order(straddle_payload(targets=3), self.who)
        self.assertEqual(len(offline.paper_child_orders(order_id)), 3)

    def test_entry_and_target_are_both_reachable_by_id(self):
        order_id = offline.record_paper_order(straddle_payload(), self.who)
        child = offline.paper_child_orders(order_id)[0]
        self.assertEqual(offline.paper_order_status(order_id)[0], 'FILLED')
        self.assertEqual(
            offline.paper_order_status(child['order_id'])[0], 'WORKING')

    def test_the_target_belongs_to_whoever_sent_the_entry(self):
        order_id = offline.record_paper_order(straddle_payload(), self.other)
        child = offline.paper_child_orders(order_id)[0]
        self.assertEqual(child['username'], self.other)


class PaperTargetCancelTests(SimpleTestCase):
    def setUp(self):
        self.who = 'bo-%s' % self._testMethodName
        self.order_id = offline.record_paper_order(straddle_payload(), self.who)
        self.child_id = offline.paper_child_orders(self.order_id)[0]['order_id']

    def test_pulling_the_entry_pulls_the_target(self):
        offline.cancel_paper_order(self.order_id)
        status, description = offline.paper_order_status(self.child_id)
        self.assertEqual(status, 'CANCELED')
        self.assertEqual(description, 'offline cancel')

    def test_pulling_the_entry_still_reports_the_entry_cancelled(self):
        offline.cancel_paper_order(self.order_id)
        status, _ = offline.paper_order_status(self.order_id)
        self.assertEqual(status, 'CANCELED')

    def test_pulling_the_target_leaves_the_entry_alone(self):
        offline.cancel_paper_order(self.child_id)
        status, description = offline.paper_order_status(self.order_id)
        self.assertEqual(status, 'FILLED')
        self.assertEqual(description, 'offline fill')

    def test_pulling_the_target_reports_the_target_cancelled(self):
        offline.cancel_paper_order(self.child_id)
        status, _ = offline.paper_order_status(self.child_id)
        self.assertEqual(status, 'CANCELED')

    def test_one_entry_does_not_pull_another_entry_target(self):
        other_id = offline.record_paper_order(straddle_payload(), self.who)
        # a second entry of the same user's, booked after the one in setUp
        other_child = offline.paper_child_orders(other_id)[0]['order_id']
        offline.cancel_paper_order(self.order_id)
        status, _ = offline.paper_order_status(other_child)
        self.assertEqual(status, 'WORKING')

    def test_pulling_an_entry_pulls_every_target_on_it(self):
        order_id = offline.record_paper_order(straddle_payload(targets=2), self.who)
        offline.cancel_paper_order(order_id)
        states = [offline.paper_order_status(child['order_id'])[0]
                  for child in offline.paper_child_orders(order_id)]
        self.assertEqual(states, ['CANCELED', 'CANCELED'])

    def test_pulling_an_entry_twice_is_still_cancelled(self):
        offline.cancel_paper_order(self.order_id)
        self.assertTrue(offline.cancel_paper_order(self.order_id))
        status, _ = offline.paper_order_status(self.child_id)
        self.assertEqual(status, 'CANCELED')


class PaperTargetSummaryTests(SimpleTestCase):
    def setUp(self):
        self.who = 'cy-%s' % self._testMethodName
        self.other = 'dee-%s' % self._testMethodName
        self.order_id = offline.record_paper_order(straddle_payload(), self.who)
        self.child_id = offline.paper_child_orders(self.order_id)[0]['order_id']

    def test_a_target_is_not_an_order_of_its_own(self):
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(len(summaries), 1)

    def test_the_row_reported_is_the_entry(self):
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(summaries[0]['tag'], self.order_id)

    def test_the_target_is_reported_inside_the_entry(self):
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(len(summaries[0]['child_orders']), 1)

    def test_the_reported_target_carries_its_own_id(self):
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(summaries[0]['child_orders'][0]['tag'], self.child_id)

    def test_the_reported_target_carries_its_own_state(self):
        summaries = offline.paper_order_summaries(self.who)
        child = summaries[0]['child_orders'][0]
        self.assertEqual(child['status'], 'WORKING')
        self.assertEqual(child['status_desp'], 'offline working')

    def test_a_target_reads_like_any_other_row(self):
        summaries = offline.paper_order_summaries(self.who)
        child = summaries[0]['child_orders'][0]
        self.assertEqual(sorted(child.keys()), sorted(summaries[0].keys()))

    def test_a_target_holds_nothing_underneath_itself(self):
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(summaries[0]['child_orders'][0]['child_orders'], [])

    def test_a_pulled_target_is_reported_pulled(self):
        offline.cancel_paper_order(self.order_id)
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(
            summaries[0]['child_orders'][0]['status'], 'CANCELED')

    def test_an_entry_with_no_target_reports_none(self):
        offline.record_paper_order(straddle_payload(targets=0), self.other)
        summaries = offline.paper_order_summaries(self.other)
        self.assertEqual(summaries[0]['child_orders'], [])

    def test_two_entries_report_two_rows(self):
        offline.record_paper_order(straddle_payload(), self.who)
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(len(summaries), 2)

    def test_each_entry_reports_its_own_target(self):
        second = offline.record_paper_order(straddle_payload(), self.who)
        second_child = offline.paper_child_orders(second)[0]['order_id']
        summaries = offline.paper_order_summaries(self.who)
        tags = [row['child_orders'][0]['tag'] for row in summaries]
        self.assertEqual(sorted(tags), sorted([self.child_id, second_child]))

    def test_an_entry_with_two_targets_reports_both(self):
        offline.record_paper_order(straddle_payload(targets=2), self.other)
        summaries = offline.paper_order_summaries(self.other)
        self.assertEqual(len(summaries[0]['child_orders']), 2)

    def test_another_users_entry_is_not_reported(self):
        offline.record_paper_order(straddle_payload(), self.other)
        summaries = offline.paper_order_summaries(self.who)
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]['tag'], self.order_id)

    def test_the_other_user_gets_their_own_row_and_target(self):
        other_id = offline.record_paper_order(straddle_payload(), self.other)
        other_child = offline.paper_child_orders(other_id)[0]['order_id']
        summaries = offline.paper_order_summaries(self.other)
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]['tag'], other_id)
        self.assertEqual(summaries[0]['child_orders'][0]['tag'], other_child)
