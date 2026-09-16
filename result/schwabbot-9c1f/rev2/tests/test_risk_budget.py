import json

from datetime import datetime, timezone as datetime_timezone

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from BotList.models import Bot, BotOnOff, BotRefresh, BotRiskLimit, BotSetting
from Engine import offline
from Engine.risk import trading_day
from Engine.server_api import cancel_order, send_order
from Users.models import UserMessage


# Both legs quote at a mid the offline fixtures fix: the call pair is 4.20/4.40
# and the put pair 1.40/1.55, so send_order re-prices this combo at 5.78 and one
# lot costs 578 dollars.
LOT_DEBIT = 578.0

COMBO_PAYLOAD = {
    "orderLegCollection": [
        {
            "instrument": {"symbol": "XSP   260326C00600000"},
            "quantity": 1,
        },
        {
            "instrument": {"symbol": "XSP   260326P00600000"},
            "quantity": 1,
        },
    ],
    "price": 5.0,
}


class RiskBudgetTestCase(TestCase):
    """One trader, authenticated offline, with Bot1 on the books."""

    def setUp(self):
        offline._PAPER_ORDERS.clear()
        self.user = User.objects.create_user(username="trader", password="pass12345")
        self.bot = Bot.objects.create(
            botname="Bot1",
            templatename="bot1.html",
            description="Primary bot",
            created_at=timezone.now(),
        )
        BotRefresh.objects.create(
            user_id=self.user.id,
            refresh_token="offline-refresh-token",
            created_at=timezone.now(),
        )

    def set_run_setting(self, contract_type="Fixed", fixed_lots="5", risk_percentage="1", user=None):
        user = user or self.user
        BotSetting.objects.update_or_create(
            bot_id=self.bot.id,
            user_id=user.id,
            defaults={
                "setting": json.dumps({
                    "sel_symbol": "$XSP",
                    "contract_type": contract_type,
                    "fixed_lots": fixed_lots,
                    "risk_percentage": risk_percentage,
                    "strategy_type": "Terrance Trade",
                }),
                "created_at": timezone.now(),
            },
        )

    def set_limit(self, user=None, **fields):
        user = user or self.user
        defaults = {
            "cap_type": "Fixed",
            "daily_debit_cap": 100000.0,
            "cap_percentage": 0.0,
            "max_lots_per_order": 100,
            "max_lots_per_day": 100,
            "enabled": True,
            "created_at": timezone.now(),
        }
        defaults.update(fields)
        BotRiskLimit.objects.update_or_create(user_id=user.id, defaults=defaults)

    def send(self, username="trader", order_type="combo_order"):
        return send_order(username, json.dumps(COMBO_PAYLOAD), order_type)


class TradingDayTests(TestCase):
    def test_trading_day_is_the_eastern_date_of_the_moment(self):
        moment = datetime(2026, 3, 26, 3, 30, tzinfo=datetime_timezone.utc)
        self.assertEqual(trading_day(moment), "2026-03-25")

    def test_trading_day_reads_a_moment_without_a_zone_as_utc(self):
        self.assertEqual(trading_day(datetime(2026, 3, 26, 3, 30)), "2026-03-25")

    def test_trading_day_moves_with_daylight_saving(self):
        winter = datetime(2026, 3, 8, 6, 30, tzinfo=datetime_timezone.utc)
        summer = datetime(2026, 7, 1, 3, 30, tzinfo=datetime_timezone.utc)
        self.assertEqual(trading_day(winter), "2026-03-08")
        self.assertEqual(trading_day(summer), "2026-06-30")

    def test_trading_day_defaults_to_now(self):
        now_day = timezone.now().astimezone(datetime_timezone.utc)
        self.assertEqual(len(trading_day()), len("2026-03-25"))
        self.assertIn(trading_day(), [trading_day(now_day), trading_day(timezone.now())])


class RiskLimitDefaultTests(TestCase):
    def test_a_new_limit_row_meters_the_trader(self):
        limit_obj = BotRiskLimit.objects.create(user_id=7, created_at=timezone.now())
        self.assertTrue(limit_obj.enabled)


class UnmeteredSendTests(RiskBudgetTestCase):
    def test_five_lots_go_out_whole_with_no_limit_row(self):
        self.set_run_setting(fixed_lots="5")
        order_id, status, lot_size, description = self.send()
        self.assertTrue(str(order_id).startswith("OFFLINE-"))
        self.assertEqual(status, "FILLED")
        self.assertEqual(lot_size, 5)
        self.assertEqual(description, "offline fill")

    def test_five_lots_go_out_whole_with_the_row_switched_off(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=0.0, max_lots_per_order=0, max_lots_per_day=0, enabled=False)
        order_id, _, lot_size, _ = self.send()
        self.assertTrue(str(order_id).startswith("OFFLINE-"))
        self.assertEqual(lot_size, 5)

    def test_an_order_that_is_not_a_combo_is_left_alone(self):
        # Any order type other than the combo one goes out as it always did.
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=0.0, max_lots_per_order=0, max_lots_per_day=0)
        order_id, _, lot_size, _ = self.send(order_type="single_order")
        self.assertTrue(str(order_id).startswith("OFFLINE-"))
        self.assertEqual(lot_size, 1)
        self.assertEqual(UserMessage.objects.filter(user_id=self.user.id).count(), 0)


class LotClampTests(RiskBudgetTestCase):
    def test_five_lots_go_out_as_two_under_an_order_cap_of_two(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(max_lots_per_order=2)
        order_id, _, lot_size, _ = self.send()
        self.assertTrue(str(order_id).startswith("OFFLINE-"))
        self.assertEqual(lot_size, 2)

    def test_five_lots_go_out_as_three_when_three_are_free_today(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(max_lots_per_day=3)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 3)

    def test_twelve_hundred_dollars_buys_two_of_five_lots(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=1200.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 2)

    def test_eleven_hundred_dollars_buys_one_lot_at_the_quoted_mid(self):
        # 1100 pays for one lot at 5.78 and two at the 5.00 the payload carries.
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=1100.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 1)

    def test_account_balance_sizing_survives_a_budget_with_room(self):
        # 10 percent of the 25000 offline account pays for four lots.
        self.set_run_setting(contract_type="ByAccountBalance", risk_percentage="10")
        self.set_limit(daily_debit_cap=100000.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 4)

    def test_account_balance_sizing_is_cut_by_the_budget(self):
        self.set_run_setting(contract_type="ByAccountBalance", risk_percentage="10")
        self.set_limit(daily_debit_cap=1200.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 2)

    def test_three_then_one_as_the_two_lot_caps_swap_places(self):
        self.set_run_setting(fixed_lots="8")
        self.set_limit(max_lots_per_order=5, max_lots_per_day=3)
        _, _, day_capped, _ = self.send()
        self.assertEqual(day_capped, 3)

        BotRiskLimit.objects.filter(user_id=self.user.id).update(
            max_lots_per_order=1,
            max_lots_per_day=100,
        )
        _, _, order_capped, _ = self.send()
        self.assertEqual(order_capped, 1)

    def test_a_trader_with_no_run_setting_is_metered_too(self):
        self.set_limit(daily_debit_cap=100000.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 1)

    def test_a_percentage_cap_is_read_off_the_account(self):
        # 5 percent of 25000 is 1250, which pays for two lots.
        self.set_run_setting(fixed_lots="5")
        self.set_limit(cap_type="ByAccountBalance", cap_percentage=5.0, daily_debit_cap=0.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 2)


class BlockedSendTests(RiskBudgetTestCase):
    def test_five_hundred_dollars_places_nothing(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=500.0)
        order_id, status, lot_size, description = self.send()
        self.assertIsNone(order_id)
        self.assertIsNone(status)
        self.assertEqual(lot_size, 0)
        self.assertIsNone(description)
        self.assertEqual(offline._PAPER_ORDERS, {})

    def test_a_zero_cap_stops_the_first_order(self):
        self.set_run_setting(fixed_lots="1")
        self.set_limit(daily_debit_cap=0.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 0)
        self.assertEqual(offline._PAPER_ORDERS, {})

    def test_an_order_cap_of_zero_places_nothing(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(max_lots_per_order=0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 0)
        self.assertEqual(offline._PAPER_ORDERS, {})

    def test_a_skipped_send_leaves_one_message_behind(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=500.0)
        self.send()
        messages = UserMessage.objects.filter(user_id=self.user.id)
        self.assertEqual(messages.count(), 1)
        self.assertNotEqual(messages.first().message.strip(), "")

    def test_a_skipped_send_holds_no_money(self):
        # Nothing was placed, so raising the cap later buys the full size.
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=500.0)
        _, _, blocked_lots, _ = self.send()
        self.assertEqual(blocked_lots, 0)

        BotRiskLimit.objects.filter(user_id=self.user.id).update(daily_debit_cap=1156.0)
        _, _, lot_size, _ = self.send()
        self.assertEqual(lot_size, 2)

    def test_every_skipped_send_writes_its_own_message(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=500.0)
        self.send()
        self.send()
        self.assertEqual(UserMessage.objects.filter(user_id=self.user.id).count(), 2)

    def test_a_skipped_send_switches_the_bot_off(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=500.0)
        BotOnOff.objects.create(
            bot_id=self.bot.id,
            user_id=self.user.id,
            status=True,
            created_at=timezone.now(),
        )
        self.send()
        onoff_obj = BotOnOff.objects.get(bot_id=self.bot.id, user_id=self.user.id)
        self.assertFalse(onoff_obj.status)


class DayLedgerTests(RiskBudgetTestCase):
    def test_two_lots_then_one_on_an_eighteen_hundred_dollar_day(self):
        # 1800 pays for three lots; the first order takes two of them.
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1800.0)
        _, _, first_lots, _ = self.send()
        _, _, second_lots, _ = self.send()
        self.assertEqual(first_lots, 2)
        self.assertEqual(second_lots, 1)

    def test_the_third_order_of_that_day_finds_nothing_left(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1800.0)
        self.send()
        self.send()
        _, _, third_lots, _ = self.send()
        self.assertEqual(third_lots, 0)
        self.assertEqual(len(offline._PAPER_ORDERS), 2)

    def test_two_lots_then_one_under_a_three_lot_day(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(max_lots_per_day=3)
        _, _, first_lots, _ = self.send()
        _, _, second_lots, _ = self.send()
        _, _, third_lots, _ = self.send()
        self.assertEqual([first_lots, second_lots, third_lots], [2, 1, 0])

    def test_the_money_is_there_again_after_a_cancel(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1156.0)
        order_id, _, first_lots, _ = self.send()
        self.assertEqual(first_lots, 2)

        _, _, blocked_lots, _ = self.send()
        self.assertEqual(blocked_lots, 0)

        cancel_order("trader", order_id)
        _, _, after_cancel_lots, _ = self.send()
        self.assertEqual(after_cancel_lots, 2)

    def test_the_lots_are_there_again_after_a_cancel(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(max_lots_per_day=2)
        order_id, _, first_lots, _ = self.send()
        _, _, blocked_lots, _ = self.send()
        self.assertEqual(first_lots, 2)
        self.assertEqual(blocked_lots, 0)

        cancel_order("trader", order_id)
        _, _, after_cancel_lots, _ = self.send()
        self.assertEqual(after_cancel_lots, 2)

    def test_two_cancels_of_one_order_free_it_once(self):
        self.set_run_setting(fixed_lots="5")
        self.set_limit(daily_debit_cap=1156.0)
        order_id, _, first_lots, _ = self.send()
        self.assertEqual(first_lots, 2)

        cancel_order("trader", order_id)
        cancel_order("trader", order_id)
        _, _, after_cancel_lots, _ = self.send()
        self.assertEqual(after_cancel_lots, 2)

    def test_a_second_trader_is_untouched_by_the_first(self):
        other = User.objects.create_user(username="second", password="pass12345")
        BotRefresh.objects.create(
            user_id=other.id,
            refresh_token="offline-refresh-token",
            created_at=timezone.now(),
        )
        self.set_run_setting(fixed_lots="3")
        self.set_run_setting(fixed_lots="3", user=other)
        self.set_limit(daily_debit_cap=500.0)
        self.set_limit(user=other, daily_debit_cap=100000.0)

        _, _, blocked_lots, _ = self.send()
        _, _, other_lots, _ = self.send(username="second")
        self.assertEqual(blocked_lots, 0)
        self.assertEqual(other_lots, 3)
        self.assertEqual(UserMessage.objects.filter(user_id=other.id).count(), 0)
