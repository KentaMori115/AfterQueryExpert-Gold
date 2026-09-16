from django.test import SimpleTestCase

from Engine.schwab_api import (
    generate_access_token,
    get_access_headers,
    get_order_access_headers,
    get_token_req_headers,
    schwab_api_get_account_balance,
    schwab_api_get_history_candle,
    schwab_api_get_option_chain,
    schwab_api_quote,
)


class SchwabApiOfflineTests(SimpleTestCase):
    def test_schwab_api_quote_offline(self):
        quote = schwab_api_quote({}, "$VIX")
        self.assertEqual(quote["lastPrice"], 18.20)

    def test_schwab_api_get_history_candle_offline(self):
        candles = schwab_api_get_history_candle({}, "$XSP", "day", 1, "daily", 1, 0)
        self.assertTrue(len(candles) >= 1)

    def test_schwab_api_get_option_chain_call_offline(self):
        chain = schwab_api_get_option_chain({}, "$XSP", "CALL")
        self.assertIn("callExpDateMap", chain)

    def test_schwab_api_get_account_balance_offline(self):
        self.assertEqual(schwab_api_get_account_balance({}), 25000.0)

    def test_generate_access_token_offline(self):
        self.assertEqual(
            generate_access_token({}, "refresh-token"),
            "offline-access-token",
        )


class SchwabApiHeaderTests(SimpleTestCase):
    def test_get_access_headers(self):
        headers = get_access_headers("Bearer", "abc123")
        self.assertEqual(headers["Authorization"], "Bearer abc123")

    def test_get_order_access_headers(self):
        headers = get_order_access_headers("Bearer", "abc123")
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_get_token_req_headers_uses_basic_auth(self):
        headers = get_token_req_headers("key", "secret")
        self.assertTrue(headers["Authorization"].startswith("Basic "))
