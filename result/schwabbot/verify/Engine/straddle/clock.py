"""How much of the session is left.

The short premium structures are same day options: the chains the engine asks
for are pulled with ``from_date`` and ``to_date`` both set to today, so
whatever is still open when the bell goes is settled by the exchange rather
than by the bot.  Everything the exit side does is driven by this one number.
"""

from datetime import datetime

import pytz

from Engine.config import BOT2_TIME_ZONE

MARKET_CLOSE_HOUR = 16
MARKET_CLOSE_MINUTE = 0

# How close to the bell the bot stops waiting for its profit target and takes
# whatever the market is showing.  Ten minutes is the same cushion the bot
# already gives itself before a run, ``BOT2_CHECK_MIN``.
EXIT_CUSHION_MIN = 10

# How often the sweep looks at what is still open between the run and the
# bell.  Small enough that the cushion is never stepped over, large enough
# that a quiet afternoon is not spent quoting options nobody is closing.
EXIT_SWEEP_MIN = 5


def market_timezone(time_zone=None):
    """The zone the trading day is measured in."""
    return pytz.timezone(time_zone or BOT2_TIME_ZONE)


def in_market_time(now, time_zone=None):
    """A moment as the exchange sees it.

    A naive moment is already exchange time and is only labelled; an aware one
    is converted.  Anything that is not a moment at all gives None.
    """
    if not isinstance(now, datetime):
        return None
    zone = market_timezone(time_zone)
    if now.tzinfo is None:
        return zone.localize(now)
    return now.astimezone(zone)


def minutes_to_close(now, time_zone=None):
    """Whole minutes left in the session, negative once it has ended.

    Part of a minute does not count, so the answer only reaches zero once the
    bell is under a minute away, and a moment past the bell gives a negative
    number rather than zero.
    """
    moment = in_market_time(now, time_zone)
    if moment is None:
        return None
    close = moment.replace(
        hour=MARKET_CLOSE_HOUR,
        minute=MARKET_CLOSE_MINUTE,
        second=0,
        microsecond=0,
    )
    remaining = close - moment
    return int(remaining.total_seconds() // 60)
