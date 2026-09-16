"""When a password change request stops being usable.

The administrator hands out a secret code by phone or mail while the desk is
open, so a code is worth something only for the rest of that trading session.
The rule this module owns is therefore a wall clock one: a code runs out at
the next market close, and a close only ever falls on a weekday.

Everything here works on aware datetimes. The project stores datetimes in UTC
(``USE_TZ`` is on) while the trading day is an ``US/Eastern`` day, so the
conversion has to happen before the calendar is read, not after.
"""

from datetime import datetime, timedelta

import pytz


# The desk the administrator sits at, and the moment it closes. Both are the
# trading conventions the bots already run on, see Engine/config.py.
RESET_TIME_ZONE = 'US/Eastern'
MARKET_CLOSE_HOUR = 16
MARKET_CLOSE_MINUTE = 0

# Saturday and Sunday in datetime.weekday() terms.
WEEKEND_DAYS = (5, 6)

# A close is never more than three days away (a Friday evening approval waits
# for Monday), so a week of candidates is always enough to find one.
_SEARCH_DAYS = 8


def reset_zone():
    """The timezone the trading day is measured in."""
    return pytz.timezone(RESET_TIME_ZONE)


def is_trading_day(day):
    """Whether a ``date`` is a day the desk is open."""
    return day.weekday() not in WEEKEND_DAYS


def close_on(day):
    """The market close of one calendar day, as an aware datetime.

    The day is read in ``US/Eastern``, so the result is 16:00 local whatever
    daylight saving is doing that week. 16:00 never falls inside a US clock
    change, which happens overnight, so the local time is always real and
    never ambiguous.
    """
    zone = reset_zone()
    naive = datetime(
        day.year,
        day.month,
        day.day,
        MARKET_CLOSE_HOUR,
        MARKET_CLOSE_MINUTE,
    )
    return zone.localize(naive)


def next_market_close(moment):
    """The first weekday market close strictly later than ``moment``.

    ``moment`` is an aware datetime in any zone. The search starts on the
    ``US/Eastern`` day that instant falls on, so an approval at 09:00 gets
    that afternoon's close, an approval at 16:00 exactly has already missed
    it and rolls on, and an approval over a weekend waits for Monday.
    """
    if moment is None:
        return None

    local = moment.astimezone(reset_zone())
    day = local.date()
    for _ in range(_SEARCH_DAYS):
        if is_trading_day(day):
            close = close_on(day)
            if close > moment:
                return close
        day = day + timedelta(days=1)
    return None
