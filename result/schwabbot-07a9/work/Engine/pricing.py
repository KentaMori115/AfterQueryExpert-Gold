"""Tick grid arithmetic and per leg net quoting for working orders.

Every price this bot sends has to sit on the tick grid of the index it
trades, and the grid is coarse enough that a naive ``floor(price / tick)``
lands on the wrong rung: ``0.29 / 0.01`` is ``28.999999999999996`` in binary
floating point, so flooring it walks a price that was already valid down by a
full cent. Snapping goes through ``decimal`` here for that reason, and a price
that already sits on the grid is returned untouched.

The other half of the module turns an order payload plus a quote map into the
two prices a working order cares about: the midpoint it opens at, and the far
touch it is willing to walk to.
"""

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR

# Quote arithmetic runs in floats, so a value that should be exactly on the
# grid can arrive a few ULPs away. Fold that noise away before the decimal
# conversion; option prices never carry more than a few real decimals.
_NOISE_PLACES = 10


def _dec(value):
    """float -> Decimal, with binary float noise folded away first."""
    return Decimal(str(round(float(value), _NOISE_PLACES)))


def snap(price, tick, up):
    """Snap ``price`` onto the ``tick`` grid, ceiling when ``up`` else floor.

    A price already on the grid comes back unchanged, which is the whole
    reason this does not go through ``math.floor``.
    """
    if tick is None or price is None:
        return None
    step = _dec(tick)
    if step <= 0:
        return None
    rule = ROUND_CEILING if up else ROUND_FLOOR
    rungs = (_dec(price) / step).quantize(Decimal(1), rounding=rule)
    return float(rungs * step)


def snap_in_favour(price, tick, credit):
    """Snap toward the side of the grid that favours the trader.

    A credit is money coming in, so it rounds up; a debit is money going out,
    so it rounds down. Either way the snapped price is never worse for the
    account than the raw one.
    """
    return snap(price, tick, bool(credit))


def is_credit(payload):
    """True for an order whose fill pays the account.

    Reads ``orderType``; anything that is not a net credit is treated as a
    debit, which is what the older single leg LIMIT and NET_DEBIT payloads
    want anyway.
    """
    if not isinstance(payload, dict):
        return False
    return str(payload.get("orderType") or "").strip().upper() == "NET_CREDIT"


def leg_is_short(leg):
    """True when the leg sells to open or sells to close."""
    if not isinstance(leg, dict):
        return False
    return str(leg.get("instruction") or "").strip().upper().startswith("SELL")


def leg_symbol(leg):
    if not isinstance(leg, dict):
        return None
    instrument = leg.get("instrument")
    if not isinstance(instrument, dict):
        return None
    symbol = instrument.get("symbol")
    return symbol if isinstance(symbol, str) and symbol else None


def leg_touches(symbol, quotes):
    """(bid, ask) for ``symbol``, or None when the quote map cannot serve it."""
    if not isinstance(quotes, dict):
        return None
    row = quotes.get(symbol)
    if not isinstance(row, dict):
        return None
    quote = row.get("quote")
    if not isinstance(quote, dict):
        return None
    bid = quote.get("bidPrice")
    ask = quote.get("askPrice")
    if bid is None or ask is None:
        return None
    try:
        return float(bid), float(ask)
    except (TypeError, ValueError):
        return None


def net_touches(payload, quotes):
    """Aggregate one payload's legs into ``(mid, far)``.

    Short legs pay the account and long legs cost it, so a credit package is
    worth ``shorts - longs`` and a debit package ``longs - shorts``. The
    midpoint values every leg at its own midpoint. The far touch values every
    leg at whichever side of its spread pays the account least: shorts at
    their bid, longs at their ask.

    Returns ``(None, None)`` when any leg is missing from ``quotes`` or the
    payload carries no legs at all, since a partial package has no price.
    """
    if not isinstance(payload, dict):
        return None, None
    legs = payload.get("orderLegCollection")
    if not isinstance(legs, list) or not legs:
        return None, None

    credit = is_credit(payload)
    short_mid = short_far = 0.0
    long_mid = long_far = 0.0

    for leg in legs:
        symbol = leg_symbol(leg)
        if symbol is None:
            return None, None
        touches = leg_touches(symbol, quotes)
        if touches is None:
            return None, None
        bid, ask = touches
        mid = (bid + ask) / 2.0
        if leg_is_short(leg):
            short_mid += mid
            short_far += bid
        else:
            long_mid += mid
            long_far += ask

    if credit:
        return short_mid - long_mid, short_far - long_far
    return long_mid - short_mid, long_far - short_far
