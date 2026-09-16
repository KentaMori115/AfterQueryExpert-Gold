"""Ending a short premium day.

Bot 2 puts its gap-up structures on as a credit with a profit target riding
underneath as a child order, and then it stops thinking about them.  When the
market comes to the target the child fills and the day is over.  When it does
not, nothing happens at all: the target sits there working, the short options
run into the bell, and same day contracts that reach the bell are settled by
the exchange on terms nobody chose.

This module answers the only question the bot needs answering once its entry
is live: leave it alone, or get out now.  Getting out is two moves rather than
one, because the working target and a fresh closing order both want the same
contracts, and a bot that sends the second without pulling the first can have
both fill and end the day short the structure it was trying to leave.

Prices here come off the touch, not the middle.  An entry can afford to sit
between the bid and the ask and wait; an exit with minutes left in the session
cannot, so a leg being bought back is priced at the ask and a leg being sold
back at the bid.  What that adds up to is usually a debit, and a debit rounds
down.  It is not always a debit: a defined risk structure whose wings have
gone further in the money than its body comes back as a credit, and a credit
rounds up.
"""

from Engine.straddle.clock import EXIT_CUSHION_MIN
from Engine.straddle.ticks import snap_down, snap_up

HOLD = 'hold'
CLOSE = 'close'

# An opening leg and the leg that undoes it.  The same pairing decides the
# sign of a fill price in the order result summaries.
CLOSING_INSTRUCTION = {
    'SELL_TO_OPEN': 'BUY_TO_CLOSE',
    'BUY_TO_OPEN': 'SELL_TO_CLOSE',
}

# Which side of the market each closing leg has to pay.
TOUCH_FIELD = {
    'BUY_TO_CLOSE': 'askPrice',
    'SELL_TO_CLOSE': 'bidPrice',
}


def _legs_of(payload):
    if not isinstance(payload, dict):
        return None
    legs = payload.get('orderLegCollection')
    if not isinstance(legs, list) or not legs:
        return None
    return legs


def closing_legs(entry_payload):
    """The legs that undo an entry, in the order the entry made them.

    Only the entry's own legs are turned around.  A child order already holds
    closing legs and is not part of the position being unwound.  Anything that
    is not an opening leg, or that arrives without a quantity, means the
    payload is not an entry this module can undo, and nothing is returned.
    """
    legs = _legs_of(entry_payload)
    if legs is None:
        return None

    closing = []
    for leg in legs:
        if not isinstance(leg, dict):
            return None
        instruction = CLOSING_INSTRUCTION.get(leg.get('instruction'))
        if instruction is None:
            return None
        quantity = leg.get('quantity')
        if quantity is None:
            return None
        instrument = leg.get('instrument')
        if not isinstance(instrument, dict) or not instrument.get('symbol'):
            return None
        closing.append({
            'instruction': instruction,
            'quantity': quantity,
            'instrument': dict(instrument),
        })
    return closing


def _touch(quote_map, symbol, field):
    if not isinstance(quote_map, dict):
        return None
    row = quote_map.get(symbol)
    if not isinstance(row, dict):
        return None
    quote = row.get('quote')
    if not isinstance(quote, dict):
        return None
    value = quote.get(field)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _net_touch_price(legs, quote_map):
    """What unwinding one lot of the structure costs at the touch.

    Positive is money going out.  None means at least one leg could not be
    priced, which is the whole structure: half a spread is not a price.
    """
    net = 0.0
    for leg in legs:
        field = TOUCH_FIELD.get(leg['instruction'])
        if field is None:
            return None
        price = _touch(quote_map, leg['instrument'].get('symbol'), field)
        if price is None:
            return None
        if leg['instruction'] == 'BUY_TO_CLOSE':
            net += price
        else:
            net -= price
    return net


def _order(order_type, legs, price=None):
    order = {
        'orderType': order_type,
        'session': 'NORMAL',
        'duration': 'DAY',
        'orderStrategyType': 'SINGLE',
        'orderLegCollection': legs,
    }
    if price is not None:
        order['price'] = price
    return order


def buyback_order(entry_payload, quote_map, trading_symbol, at_market=False):
    """The single order that takes the structure off, or None.

    A structure that can be priced goes out as a limit order at the touch: a
    net debit rounded down to the tick, or, when the touch says the position
    can be handed back for money, a net credit rounded up.  A structure that
    cannot be priced still has to go, so it goes at market, with no price on
    it at all, and so does one asked for at market outright.
    """
    legs = closing_legs(entry_payload)
    if legs is None:
        return None

    net = None if at_market else _net_touch_price(legs, quote_map)
    if net is None:
        return _order('MARKET', legs)
    if net < 0:
        return _order('NET_CREDIT', legs, snap_up(-net, trading_symbol))
    return _order('NET_DEBIT', legs, snap_down(net, trading_symbol))


def exit_plan(entry_payload, quote_map, trading_symbol, minutes_left,
              cushion_min=EXIT_CUSHION_MIN):
    """What to do with a live entry right now.

    While the session still has room the answer is to hold and let the target
    work.  Inside the cushion the answer is to close, and there is still time
    to name a price, so the closing order is a limit at the touch.  Once the
    session has run out there is no time left to work anything and the
    structure goes at market whatever the quotes say.

    Closing also says whether a working target has to be pulled out of the way
    first, which it does whenever the entry carried one.  An entry whose legs
    cannot be turned around is not one this module can plan for and gets
    nothing back.
    """
    if closing_legs(entry_payload) is None:
        return None

    if minutes_left is None or minutes_left > cushion_min:
        return {'action': HOLD, 'cancel_child': False, 'order': None}

    children = entry_payload.get('childOrderStrategies')
    return {
        'action': CLOSE,
        'cancel_child': bool(children),
        'order': buyback_order(entry_payload, quote_map, trading_symbol,
                               at_market=minutes_left <= 0),
    }
