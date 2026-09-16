"""Concession ladder for a working combo order.

The bots open at the midpoint and then replace the order a few times before
falling back to a market order. Replacing it at the same midpoint every time
is not a concession, so nothing about the order gets more likely to fill; the
ladder here walks the working price from that midpoint toward the far touch
in even steps, and hands the engine the rung it should be quoting.

Two rules shape every rung. It sits on the tick grid of the index being
traded, snapped toward whichever side favours the account, so a rung is never
worse than the arithmetic asked for and the last rung never reaches past the
far touch. And a rung that repeats the one before it is not a replacement at
all, so it is dropped and the ladder simply comes out shorter.
"""

import math

from .pricing import (
    is_credit,
    leg_is_short,
    leg_symbol,
    net_touches,
    snap,
)

# What the engines fall back to when the admin settings carry no ladder size:
# the opening quote plus three replacements, which is the cadence the older
# hard coded `repeat_cnt = 3` loop already ran on.
DEFAULT_LADDER_STEPS = 4

# The widest ladder an operator is allowed to ask for. Each rung costs a
# cancel/replace round trip against the broker, and the whole ladder has to
# finish inside the opening minutes of the session.
MAX_LADDER_STEPS = 8


def net_quote(payload, quotes):
    """``(mid, far)`` for one order payload against a quote map.

    ``mid`` is the package valued leg by leg at each leg's own midpoint.
    ``far`` is the same package valued at whichever side of every leg's
    spread pays the account least, which is the worst price the ladder is
    ever willing to work. Child order strategies are not part of the working
    price and are ignored.

    Both come back as ``None`` when the payload has no legs or when any leg's
    symbol is missing from ``quotes``.
    """
    return net_touches(payload, quotes)


def ladder_prices(mid, far, steps, tick, credit, cap=None):
    """The rungs a working order walks, opening rung first.

    The rungs divide the span from ``mid`` to ``far`` evenly: with ``steps``
    rungs asked for, rung ``k`` sits ``k / (steps - 1)`` of the way across,
    so the first is the midpoint and the last reaches the far touch. Each is
    then snapped onto the ``tick`` grid toward the side that favours the
    account, up for a credit and down for a debit, which also keeps the last
    rung on the near side of the far touch whenever that touch is off grid.

    A ``cap`` is an upper bound on what the package may be worked at, which
    is how a defined risk spread stays cheaper than the width it can pay out.
    Both ends of the span are pulled down to it before any rung is computed,
    so a cap under the midpoint collapses the ladder to the cap itself.

    A rung that is not strictly positive is dropped, and so is one that
    repeats the rung before it, so the list is strictly monotonic and can be
    shorter than ``steps``. An empty list means there is nothing to work.
    """
    if mid is None or far is None or tick is None or steps is None:
        return []
    try:
        steps = int(steps)
        span_start = float(mid)
        span_end = float(far)
        tick = float(tick)
    except (TypeError, ValueError):
        return []
    if steps < 1 or tick <= 0:
        return []

    if cap is not None:
        try:
            ceiling = float(cap)
        except (TypeError, ValueError):
            return []
        span_start = min(span_start, ceiling)
        span_end = min(span_end, ceiling)

    favour_up = bool(credit)
    rungs = []
    for index in range(steps):
        if steps == 1:
            raw = span_start
        else:
            raw = span_start + (span_end - span_start) * index / float(steps - 1)
        price = snap(raw, tick, favour_up)
        if price is None or price <= 0:
            continue
        if rungs and price == rungs[-1]:
            continue
        rungs.append(price)
    return rungs


def ladder_lot_size(prices, balance, risk_percentage):
    """How many lots the account can carry across the whole ladder.

    Sizing happens at the last rung rather than the opening one. That rung is
    the worst price the package will be worked at, so it is the one the
    budget has to cover; sizing on the midpoint leaves an account short the
    moment the ladder concedes. The budget is ``risk_percentage`` of
    ``balance``, and a lot costs the rung times the hundred multiplier.

    Returns 0 whenever the ladder is empty or either figure works out non
    positive, which is the same signal the engines already read as "skip this
    user".
    """
    if not prices:
        return 0
    try:
        worst = float(prices[-1])
        balance = float(balance)
        risk_percentage = float(risk_percentage)
    except (TypeError, ValueError, IndexError):
        return 0

    budget = balance * risk_percentage / 100.0
    if budget <= 0:
        return 0
    cost_per_lot = worst * 100.0
    if cost_per_lot <= 0:
        return 0
    lots = int(math.floor(budget / cost_per_lot))
    return lots if lots > 0 else 0


def ladder_concession(prices):
    """How far the ladder is willing to move off its opening rung.

    Zero for a ladder that collapsed to one rung, which is the engine's cue
    that there is nothing to work and the package may as well go to market.
    """
    if not prices or len(prices) < 2:
        return 0.0
    return abs(float(prices[-1]) - float(prices[0]))


# ---------------------------------------------------------------------------
# What the engine drives the ladder with.
# ---------------------------------------------------------------------------


def clamp_steps(value):
    """Coerce an operator supplied ladder size into the supported range."""
    try:
        steps = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LADDER_STEPS
    if steps < 1:
        return 1
    if steps > MAX_LADDER_STEPS:
        return MAX_LADDER_STEPS
    return steps


class LadderPlan(object):
    """One package's rungs plus the bookkeeping the working loop needs."""

    def __init__(self, credit, mid, far, prices, width=None, cap=None):
        self.credit = bool(credit)
        self.mid = mid
        self.far = far
        self.prices = list(prices or [])
        self.width = width
        self.cap = cap

    def __len__(self):
        return len(self.prices)

    @property
    def opening_price(self):
        return self.prices[0] if self.prices else None

    @property
    def final_price(self):
        return self.prices[-1] if self.prices else None

    def price_at(self, index):
        """The rung for replacement ``index``, or None once the ladder ends."""
        if index < 0 or index >= len(self.prices):
            return None
        return self.prices[index]

    def market_after(self):
        """The replacement index at which the order becomes a market order."""
        return len(self.prices)

    def lot_size(self, balance, risk_percentage):
        return ladder_lot_size(self.prices, balance, risk_percentage)

    def concession(self):
        return ladder_concession(self.prices)

    def describe(self):
        """One line for the run log: side, span, cap and every rung."""
        side = 'credit' if self.credit else 'debit'
        span = 'no quote'
        if self.mid is not None and self.far is not None:
            span = f'mid {self.mid:.4f} -> far {self.far:.4f}'
        cap = 'none' if self.cap is None else f'{self.cap:.2f}'
        rungs = ', '.join(f'{price:.2f}' for price in self.prices) or 'none'
        return (f'{side} ladder | {span} | cap {cap} | '
                f'concession {self.concession():.2f} | rungs [{rungs}]')


def width_cap(width, tick):
    """Highest price a defined risk package may be worked at.

    A spread that can only ever pay out its strike width is not worth paying
    the width for, so the working price stops one tick short of it. Packages
    with no width, the naked ones, carry no cap.
    """
    if width is None or tick is None:
        return None
    try:
        return float(width) - float(tick)
    except (TypeError, ValueError):
        return None


def plan_for_payload(payload, quotes, steps, tick, width=None):
    """Build the :class:`LadderPlan` for one payload at the current quotes."""
    mid, far = net_quote(payload, quotes)
    credit = is_credit(payload)
    cap = width_cap(width, tick)
    prices = ladder_prices(mid, far, clamp_steps(steps), tick, credit, cap)
    return LadderPlan(credit, mid, far, prices, width, cap)


def package_width(payload):
    """Strike width of a defined risk package, or None when it has none.

    A package is defined risk when it carries both a long and a short leg;
    the width is the widest gap between a short strike and a long strike,
    read straight off the option symbols.
    """
    if not isinstance(payload, dict):
        return None
    legs = payload.get("orderLegCollection")
    if not isinstance(legs, list):
        return None
    shorts, longs = [], []
    for leg in legs:
        symbol = leg_symbol(leg)
        strike = strike_of(symbol)
        if strike is None:
            continue
        if leg_is_short(leg):
            shorts.append(strike)
        else:
            longs.append(strike)
    if not shorts or not longs:
        return None
    return max(abs(long_strike - short_strike)
               for short_strike in shorts for long_strike in longs)


def strike_of(option_symbol):
    """Strike price encoded in an OCC style option symbol, or None."""
    if not isinstance(option_symbol, str) or len(option_symbol) < 14:
        return None
    try:
        return float(option_symbol[13:]) / 1000.0
    except ValueError:
        return None
