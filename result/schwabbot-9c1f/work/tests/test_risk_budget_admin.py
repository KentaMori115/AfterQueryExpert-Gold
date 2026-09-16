import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from BotList.models import Bot, BotOnOff, BotRefresh, BotRiskLimit, BotSetting
from Engine.server_api import send_order
from Users.models import UserAllow


RISK_BUDGET_PAGE = "/admin/risk_budget/"
RISK_BUDGET_CHANGE = "/admin/risk_budget_change/"
RISK_BUDGET_RELEASE = "/admin/risk_budget_release/"
BOT_ONOFF = "/bot_onoff/"

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


class RiskBudgetAdminTestCase(TestCase):
    """An admin, a trader who is allowed to log in, and Bot1."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="root",
            password="pass12345",
            is_staff=True,
            is_superuser=True,
        )
        self.trader = User.objects.create_user(username="trader", password="pass12345")
        UserAllow.objects.create(
            user_id=self.trader.id,
            status=True,
            description="",
            created_at=timezone.now(),
        )
        self.bot = Bot.objects.create(
            botname="Bot1",
            templatename="bot1.html",
            description="Primary bot",
            created_at=timezone.now(),
        )
        BotRefresh.objects.create(
            user_id=self.trader.id,
            refresh_token="offline-refresh-token",
            created_at=timezone.now(),
        )

    def budget_payload(self, **fields):
        payload = {
            "user_id": self.trader.id,
            "cap_type": "Fixed",
            "daily_debit_cap": 5000,
            "cap_percentage": 0,
            "max_lots_per_order": 4,
            "max_lots_per_day": 9,
            "enabled": True,
        }
        payload.update(fields)
        return payload

    def post(self, url, payload):
        return self.client.post(url, data=json.dumps(payload), content_type="application/json")

    def set_run_setting(self, contract_type="Fixed", fixed_lots="5", risk_percentage="1"):
        BotSetting.objects.update_or_create(
            bot_id=self.bot.id,
            user_id=self.trader.id,
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

    def set_limit(self, **fields):
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
        BotRiskLimit.objects.update_or_create(user_id=self.trader.id, defaults=defaults)


class RiskBudgetPageTests(RiskBudgetAdminTestCase):
    def test_the_page_is_served_to_an_admin(self):
        self.client.login(username="root", password="pass12345")
        response = self.client.get(RISK_BUDGET_PAGE)
        self.assertEqual(response.status_code, 200)

    def test_the_page_carries_a_row_for_every_trader(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=5000.0)
        send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")

        self.client.login(username="root", password="pass12345")
        response = self.client.get(RISK_BUDGET_PAGE)
        rows = {row["user_id"]: row for row in response.context["risk_budget_records"]}
        self.assertIn(self.admin.id, rows)

        row = rows[self.trader.id]
        self.assertEqual(row["daily_debit_cap"], 5000.0)
        self.assertEqual(row["committed_debit"], 1156.0)
        self.assertEqual(row["remaining_debit"], 3844.0)

    def test_a_trader_is_sent_away_from_the_page(self):
        self.client.login(username="trader", password="pass12345")
        response = self.client.get(RISK_BUDGET_PAGE)
        self.assertEqual(response.status_code, 302)


class RiskBudgetAccessTests(RiskBudgetAdminTestCase):
    def setUp(self):
        super().setUp()
        self.client.login(username="trader", password="pass12345")

    def test_a_trader_cannot_save_a_budget(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload())
        self.assertEqual(response.status_code, 302)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_a_trader_cannot_move_their_own_cap(self):
        self.set_limit(daily_debit_cap=1156.0)
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(daily_debit_cap=999999))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(BotRiskLimit.objects.get(user_id=self.trader.id).daily_debit_cap, 1156.0)

    def test_a_trader_cannot_release_their_own_day(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1156.0)
        send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")

        response = self.post(RISK_BUDGET_RELEASE, {"user_id": self.trader.id})
        self.assertEqual(response.status_code, 302)

        _, _, lots_after, _ = send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")
        self.assertEqual(lots_after, 0)


class RiskBudgetChangeTests(RiskBudgetAdminTestCase):
    def setUp(self):
        super().setUp()
        self.client.login(username="root", password="pass12345")

    def test_posting_a_budget_writes_the_row(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload())
        self.assertEqual(response.status_code, 200)

        limit_obj = BotRiskLimit.objects.get(user_id=self.trader.id)
        self.assertEqual(limit_obj.cap_type, "Fixed")
        self.assertEqual(limit_obj.daily_debit_cap, 5000)
        self.assertEqual(limit_obj.max_lots_per_order, 4)
        self.assertEqual(limit_obj.max_lots_per_day, 9)
        self.assertTrue(limit_obj.enabled)

    def test_posting_again_moves_the_same_row(self):
        self.post(RISK_BUDGET_CHANGE, self.budget_payload())
        self.post(RISK_BUDGET_CHANGE, self.budget_payload(
            cap_type="ByAccountBalance",
            cap_percentage=2.5,
            max_lots_per_order=1,
            enabled=False,
        ))

        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 1)
        limit_obj = BotRiskLimit.objects.get(user_id=self.trader.id)
        self.assertEqual(limit_obj.cap_type, "ByAccountBalance")
        self.assertEqual(limit_obj.cap_percentage, 2.5)
        self.assertEqual(limit_obj.max_lots_per_order, 1)
        self.assertFalse(limit_obj.enabled)

    def test_minus_one_is_refused(self):
        self.post(RISK_BUDGET_CHANGE, self.budget_payload())
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(daily_debit_cap=-1))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.get(user_id=self.trader.id).daily_debit_cap, 5000)

    def test_minus_two_lots_a_day_are_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(max_lots_per_day=-2))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_minus_two_lots_an_order_are_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(max_lots_per_order=-2))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_a_percentage_below_zero_is_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(cap_percentage=-0.5))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_a_word_where_a_lot_count_belongs_is_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(max_lots_per_order="lots"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_an_unknown_cap_type_is_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(cap_type="Whatever"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_a_budget_for_nobody_is_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(user_id=9999))
        self.assertEqual(response.status_code, 400)

    def test_a_word_where_a_number_belongs_is_refused(self):
        response = self.post(RISK_BUDGET_CHANGE, self.budget_payload(daily_debit_cap="plenty"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BotRiskLimit.objects.filter(user_id=self.trader.id).count(), 0)

    def test_reading_the_change_endpoint_is_refused(self):
        response = self.client.get(RISK_BUDGET_CHANGE)
        self.assertEqual(response.status_code, 400)


class RiskBudgetReleaseTests(RiskBudgetAdminTestCase):
    def setUp(self):
        super().setUp()
        self.client.login(username="root", password="pass12345")

    def test_two_lots_are_available_again_after_a_release(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1156.0)

        _, _, first_lots, _ = send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")
        _, _, blocked_lots, _ = send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")
        self.assertEqual(first_lots, 2)
        self.assertEqual(blocked_lots, 0)

        response = self.post(RISK_BUDGET_RELEASE, {"user_id": self.trader.id})
        self.assertEqual(response.status_code, 200)

        _, _, after_release_lots, _ = send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")
        self.assertEqual(after_release_lots, 2)

    def test_releasing_one_day_leaves_the_other_traders_alone(self):
        other = User.objects.create_user(username="second", password="pass12345")
        BotRefresh.objects.create(
            user_id=other.id,
            refresh_token="offline-refresh-token",
            created_at=timezone.now(),
        )
        BotRiskLimit.objects.create(
            user_id=other.id,
            cap_type="Fixed",
            daily_debit_cap=1156.0,
            cap_percentage=0.0,
            max_lots_per_order=100,
            max_lots_per_day=100,
            enabled=True,
            created_at=timezone.now(),
        )
        BotSetting.objects.create(
            bot_id=self.bot.id,
            user_id=other.id,
            setting=json.dumps({
                "sel_symbol": "$XSP",
                "contract_type": "Fixed",
                "fixed_lots": "2",
                "risk_percentage": "1",
                "strategy_type": "Terrance Trade",
            }),
            created_at=timezone.now(),
        )

        send_order("second", json.dumps(COMBO_PAYLOAD), "combo_order")
        self.post(RISK_BUDGET_RELEASE, {"user_id": self.trader.id})

        _, _, lots_after, _ = send_order("second", json.dumps(COMBO_PAYLOAD), "combo_order")
        self.assertEqual(lots_after, 0)

    def test_releasing_for_nobody_is_refused(self):
        response = self.post(RISK_BUDGET_RELEASE, {"user_id": 9999})
        self.assertEqual(response.status_code, 400)

    def test_reading_the_release_endpoint_is_refused(self):
        response = self.client.get(RISK_BUDGET_RELEASE)
        self.assertEqual(response.status_code, 400)


class BotStartTests(RiskBudgetAdminTestCase):
    def setUp(self):
        super().setUp()
        self.client.login(username="trader", password="pass12345")

    def run_setting_body(self):
        return {
            "bot_id": self.bot.id,
            "run_setting": {
                "sel_symbol": "$XSP",
                "contract_type": "Fixed",
                "fixed_lots": "2",
                "risk_percentage": "1",
                "strategy_type": "Terrance Trade",
            },
        }

    def test_a_trader_with_room_starts_the_bot(self):
        self.set_limit(daily_debit_cap=100000.0)
        response = self.post(BOT_ONOFF, self.run_setting_body())
        self.assertEqual(json.loads(response.content)["status"], "success")
        self.assertTrue(BotOnOff.objects.get(bot_id=self.bot.id, user_id=self.trader.id).status)

    def test_a_zero_cap_keeps_the_run_button_shut(self):
        self.set_limit(daily_debit_cap=0.0)
        response = self.post(BOT_ONOFF, self.run_setting_body())
        self.assertEqual(json.loads(response.content)["status"], "fail")
        self.assertEqual(BotOnOff.objects.filter(bot_id=self.bot.id, user_id=self.trader.id).count(), 0)

    def test_a_day_spent_on_orders_keeps_the_run_button_shut(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=1156.0)
        send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")

        response = self.post(BOT_ONOFF, self.run_setting_body())
        self.assertEqual(json.loads(response.content)["status"], "fail")
        self.assertEqual(BotOnOff.objects.filter(bot_id=self.bot.id, user_id=self.trader.id).count(), 0)

    def test_a_day_out_of_lots_keeps_the_run_button_shut(self):
        self.set_run_setting(fixed_lots="2")
        self.set_limit(daily_debit_cap=100000.0, max_lots_per_day=2)
        send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")

        response = self.post(BOT_ONOFF, self.run_setting_body())
        self.assertEqual(json.loads(response.content)["status"], "fail")
        self.assertEqual(BotOnOff.objects.filter(bot_id=self.bot.id, user_id=self.trader.id).count(), 0)

    def test_a_trader_nobody_metered_starts_the_bot(self):
        response = self.post(BOT_ONOFF, self.run_setting_body())
        self.assertEqual(json.loads(response.content)["status"], "success")
        self.assertTrue(BotOnOff.objects.get(bot_id=self.bot.id, user_id=self.trader.id).status)
