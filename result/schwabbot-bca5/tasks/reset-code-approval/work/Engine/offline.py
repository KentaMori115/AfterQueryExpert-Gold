"""Offline Schwab stand-in for Harbor / local replay.

Set SBOT_OFFLINE=0 to use the live Schwab HTTP paths.
Default is offline so Docker trials never touch the network.
"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

_PAPER_ORDERS: dict[str, dict] = {}
_ORDER_SEQ = 1000


def is_offline() -> bool:
    return os.getenv("SBOT_OFFLINE", "1").strip().lower() not in {"0", "false", "no"}


def _load(name: str):
    path = FIXTURE_DIR / name
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def offline_history_candles(symbol: str, freq_type: str):
    key = (str(symbol).upper(), str(freq_type).lower())
    if key[1] == "daily":
        filename = "index_daily.json"
    else:
        filename = "vix_minute.json" if "$VIX" in key[0] or "VIX" in key[0] else "index_minute.json"
    return deepcopy(_load(filename)["candles"])


def offline_quote(symbol: str):
    quotes = _load("quotes.json")
    row = quotes.get(symbol) or quotes.get("DEFAULT")
    return deepcopy(row["quote"]) if row else None


def offline_quote_map(symbols: list[str] | str):
    if isinstance(symbols, str):
        symbols = [item.strip() for item in symbols.split(",") if item.strip()]
    quotes = _load("quotes.json")
    out = {}
    for symbol in symbols:
        row = quotes.get(symbol) or _synthetic_option_quote(symbol, quotes)
        if row is not None:
            out[symbol] = deepcopy(row)
    return out or None


def _synthetic_option_quote(symbol: str, quotes: dict):
    default = quotes.get("DEFAULT")
    if default is None:
        return None
    row = deepcopy(default)
    row["quote"]["symbol"] = symbol
    return row


def offline_option_chain(symbol: str, contract_type: str):
    kind = str(contract_type or "CALL").upper()
    root = str(symbol or "$XSP").upper().replace("$", "")
    filename = f"option_chain_{root.lower()}_{kind.lower()}.json"
    path = FIXTURE_DIR / filename
    if not path.exists():
        filename = f"option_chain_xsp_{kind.lower()}.json"
    return deepcopy(_load(filename))


def offline_account_balance():
    return float(_load("account.json")["equity"])


def offline_account_details():
    return deepcopy(_load("account.json")["accounts"])


def offline_access_token(refresh_token=None):
    if refresh_token is None:
        return None
    return "offline-access-token"


def offline_oauth_tokens():
    return {
        "refresh_token": "offline-refresh-token",
        "access_token": "offline-access-token",
    }


def record_paper_order(payload, username: str) -> str:
    global _ORDER_SEQ
    _ORDER_SEQ += 1
    order_id = f"OFFLINE-{_ORDER_SEQ}"
    _PAPER_ORDERS[order_id] = {
        "order_id": order_id,
        "username": username,
        "status": "FILLED",
        "statusDescription": "offline fill",
        "payload": deepcopy(payload) if payload is not None else {},
    }
    return order_id


def paper_order_status(order_id):
    if order_id is None:
        return None, None
    row = _PAPER_ORDERS.get(str(order_id))
    if row is None:
        return "FILLED", "offline fill"
    return row["status"], row["statusDescription"]


def cancel_paper_order(order_id) -> bool:
    if order_id is None:
        return True
    row = _PAPER_ORDERS.get(str(order_id))
    if row is None:
        return True
    row["status"] = "CANCELED"
    row["statusDescription"] = "offline cancel"
    return True


def paper_order_summaries(username: str):
    rows = [row for row in _PAPER_ORDERS.values() if row.get("username") == username]
    if rows:
        return [
            {
                "type": "LIMIT",
                "price": {"limit": "", "stop": "", "fill": "", "entry": ""},
                "leg_n": 0,
                "leg_info": [],
                "time": "2026-03-26T13:30:00Z",
                "status": row["status"],
                "status_desp": row["statusDescription"],
                "child_orders": [],
                "tag": row["order_id"],
            }
            for row in rows
        ]
    return deepcopy(_load("orders.json"))
