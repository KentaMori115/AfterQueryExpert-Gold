import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from BotList.models import Bot, BotAdminSetting, BotRefresh
from Engine import offline
from Engine.config import REF_TOKEN_EXPIRE_DAY
from Engine.server_api import (
    cancel_order,
    get_access_token,
    get_account_details,
    get_order_result_by_username,
    get_order_status,
    get_order_status_by_username,
    get_pair_quote,
    get_timezones,
    get_validsymbols,
    send_order,
)


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


class ServerApiHelperTests(TestCase):
    def test_get_timezones_is_non_empty(self):
        zones = get_timezones()
        self.assertIn("US/Eastern", zones)

    def test_get_validsymbols_includes_xsp(self):
        symbols = get_validsymbols()
        self.assertEqual(symbols[0], "$XSP")
        self.assertIn("$SPX", symbols)


class ServerApiOfflineAccountTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="trader", password="pass12345")
        BotRefresh.objects.create(
            user_id=self.user.id,
            refresh_token="offline-refresh-token",
            created_at=timezone.now(),
        )

    def test_get_account_details_offline(self):
        accounts = get_account_details(self.user.id)
        self.assertEqual(accounts[0]["accountNumber"], "12345678")

    def test_get_access_token_offline_creates_access_row(self):
        token = get_access_token(self.user.id)
        self.assertEqual(token, "offline-access-token")

    def test_get_access_token_returns_none_for_expired_refresh(self):
        BotRefresh.objects.filter(user_id=self.user.id).update(
            created_at=timezone.now() - timedelta(days=REF_TOKEN_EXPIRE_DAY + 1),
        )
        self.assertIsNone(get_access_token(self.user.id))

    def test_get_pair_quote_offline(self):
        quotes = get_pair_quote(
            "XSP   260326C00600000",
            "XSP   260326P00600000",
            self.user.id,
        )
        self.assertIn("XSP   260326C00600000", quotes)
        self.assertIn("XSP   260326P00600000", quotes)


class ServerApiOfflineOrderTests(TestCase):
    def setUp(self):
        offline._PAPER_ORDERS.clear()
        self.user = User.objects.create_user(username="trader", password="pass12345")
        Bot.objects.create(
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

    def test_send_order_offline_returns_filled_order(self):
        order_id, status, lot_size, description = send_order(
            "trader",
            json.dumps(COMBO_PAYLOAD),
            "combo_order",
        )
        self.assertTrue(str(order_id).startswith("OFFLINE-"))
        self.assertEqual(status, "FILLED")
        self.assertEqual(description, "offline fill")
        self.assertGreaterEqual(lot_size, 1)

    def test_get_order_status_offline(self):
        order_id, _, _, _ = send_order(
            "trader",
            json.dumps(COMBO_PAYLOAD),
            "combo_order",
        )
        status, description = get_order_status("offline-account", order_id, self.user.id)
        self.assertEqual(status, "FILLED")
        self.assertEqual(description, "offline fill")

    def test_get_order_status_by_username_offline(self):
        order_id, _, _, _ = send_order(
            "trader",
            json.dumps(COMBO_PAYLOAD),
            "combo_order",
        )
        status, description = get_order_status_by_username("trader", order_id)
        self.assertEqual(status, "FILLED")
        self.assertEqual(description, "offline fill")

    def test_cancel_order_offline_marks_order_canceled(self):
        order_id, _, _, _ = send_order(
            "trader",
            json.dumps(COMBO_PAYLOAD),
            "combo_order",
        )
        cancel_order("trader", order_id)
        status, description = offline.paper_order_status(order_id)
        self.assertEqual(status, "CANCELED")
        self.assertEqual(description, "offline cancel")

    def test_get_order_result_by_username_offline(self):
        send_order("trader", json.dumps(COMBO_PAYLOAD), "combo_order")
        summaries = get_order_result_by_username(
            "trader",
            "2026-03-26T00:00:00Z",
            "2026-03-26T23:59:59Z",
        )
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["status"], "FILLED")

    def test_send_order_unknown_user_returns_none(self):
        result = send_order(
            "missing-user",
            json.dumps(COMBO_PAYLOAD),
            "combo_order",
        )
        self.assertEqual(result, (None, None, None, None))


class BotAdminSettingTests(TestCase):
    def test_default_vix_flags(self):
        setting = BotAdminSetting.objects.create()
        self.assertFalse(setting.vix_automatic_mode)
        self.assertTrue(setting.vix_gap_lower)
        self.assertFalse(setting.vix_gap_up)

    def test_default_order_gap_sec(self):
        setting = BotAdminSetting.objects.create()
        self.assertEqual(setting.order_gap_sec, 10)
