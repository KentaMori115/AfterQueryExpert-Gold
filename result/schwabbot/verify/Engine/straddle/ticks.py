"""Prices on the grid the exchange will accept for a symbol.

``Engine.bot_api.get_valid_price`` already rounds an entry price, and every
order the engine has ever sent is a debit, so it only ever needed to round one
way.  An exit does not have that luxury.  A structure bought back for a debit
still rounds down, but the same structure can come back as a credit when its
protective wings are worth more than its body, and a credit rounded down gives
premium away.  Both directions live here, on a grid that is worked out in
whole ticks rather than in floating point, so a price already sitting on the
grid is left exactly where it is.
"""

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR

# Tick sizes, as ``Engine.bot_api.get_ticksize`` reports them.
TICK_SIZES = {
    '$SPX': '0.05',
    '$XSP': '0.01',
    '$XSPSIM': '0.01',
}

DEFAULT_TICK = '0.01'


def _tick(trading_symbol):
    return Decimal(TICK_SIZES.get(trading_symbol, DEFAULT_TICK))


def tick_size(trading_symbol):
    """The smallest price increment the symbol trades in."""
    return float(_tick(trading_symbol))


def _snap(price, trading_symbol, rounding):
    if price is None:
        return None
    try:
        amount = Decimal(str(float(price)))
    except (TypeError, ValueError, ArithmeticError):
        return None
    tick = _tick(trading_symbol)
    ticks = (amount / tick).quantize(Decimal(1), rounding=rounding)
    return float((ticks * tick).quantize(Decimal('0.01')))


def snap_down(price, trading_symbol):
    """The largest price on the grid that is not above this one.

    What a debit rounds to: the order asks to pay no more than the grid
    allows.  A price already on the grid does not move.
    """
    return _snap(price, trading_symbol, ROUND_FLOOR)


def snap_up(price, trading_symbol):
    """The smallest price on the grid that is not below this one.

    What a credit rounds to: the order asks to collect no less than the grid
    allows.  A price already on the grid does not move.
    """
    return _snap(price, trading_symbol, ROUND_CEILING)
