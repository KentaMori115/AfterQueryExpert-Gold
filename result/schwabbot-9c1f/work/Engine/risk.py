"""Per user risk budget for the bot order path.

An admin gives a user a `BotRiskLimit`: how much debit that account may spend
on bot orders in one trading day, and how many lots one order may carry. The
send path in `Engine/server_api.py` asks this module how many lots it is
allowed to place, and tells it what a placed order committed. A cancelled
order gives its debit back to the day.

Money here is option debit in dollars: a combo priced at 5.78 costs
5.78 * 100 * lots, the same 100 multiplier the account balance sizing in
`send_order` already uses.
"""

import math

from datetime import timezone as datetime_timezone

import pytz

from django.contrib.auth.models import User
from django.utils import timezone

from BotList.models import Bot, BotOnOff, BotRiskCommitment, BotRiskLimit
from Users.models import UserMessage


# The trading day of the exchange the bots trade, not the server clock.
TRADING_TIME_ZONE = 'US/Eastern'

# One option contract covers 100 shares of the underlying.
CONTRACT_MULTIPLIER = 100

# A cap is either a plain dollar figure or a slice of the account, the same two
# words the user's own contract type uses for lots.
CAP_FIXED = 'Fixed'
CAP_BY_ACCOUNT_BALANCE = 'ByAccountBalance'

# Written for the user when a send is skipped for want of budget.
SKIP_MESSAGE = (
    "Your bot order was skipped: today's risk budget has no room left for "
    "another lot. Ask the administrator to raise the daily cap."
)


def trading_day(moment = None):
    """The US/Eastern calendar date a moment belongs to, as 'YYYY-MM-DD'.

    A moment with no timezone is read as UTC, which is what the database
    hands back when Django is asked for a naive datetime.
    """
    if moment is None:
        moment = timezone.now()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo = datetime_timezone.utc)
    trading_tz = pytz.timezone(TRADING_TIME_ZONE)
    return moment.astimezone(trading_tz).strftime("%Y-%m-%d")


def order_debit(price, lots):
    """Dollar debit of `lots` lots of a combo priced at `price`."""
    try:
        return float(price) * CONTRACT_MULTIPLIER * int(lots)
    except (TypeError, ValueError):
        return 0.0


def active_limit(user_id):
    """The user's risk limit, or None when the user is not metered."""
    try:
        limit_obj = BotRiskLimit.objects.get(user_id = user_id)
    except BotRiskLimit.DoesNotExist:
        return None
    except BotRiskLimit.MultipleObjectsReturned:
        limit_obj = BotRiskLimit.objects.filter(user_id = user_id).order_by('-id').first()

    if limit_obj is None or not limit_obj.enabled:
        return None
    return limit_obj


def committed_debit(user_id, day = None):
    """Debit the user's live orders hold against `day`, today by default."""
    if day is None:
        day = trading_day()

    total = 0.0
    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id, trade_date = day)
    for commitment_obj in commitment_objs:
        total += commitment_obj.debit
    return total


def committed_lots(user_id, day = None):
    """Lots the user's live orders hold against `day`, today by default."""
    if day is None:
        day = trading_day()

    total = 0
    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id, trade_date = day)
    for commitment_obj in commitment_objs:
        total += commitment_obj.lots
    return total


def account_equity(user_id):
    """The account equity Schwab reports for the user, 0 when it is unreachable."""
    #imported here because server_api asks this module for the lot size
    from .server_api import get_access_token
    from .schwab_api import get_access_headers, schwab_api_get_account_balance

    access_token = get_access_token(user_id)
    if access_token is None:
        return 0.0

    try:
        headers = get_access_headers('Bearer', access_token)
        return float(schwab_api_get_account_balance(headers))
    except (TypeError, ValueError):
        return 0.0


def daily_cap(limit_obj, user_id):
    """Today's cap in dollars, whichever way the admin wrote it down."""
    if limit_obj.cap_type == CAP_BY_ACCOUNT_BALANCE:
        return account_equity(user_id) * (limit_obj.cap_percentage / 100.0)
    return limit_obj.daily_debit_cap


def remaining_debit(user_id):
    """What is left of today's cap, or None when the user is not metered."""
    limit_obj = active_limit(user_id)
    if limit_obj is None:
        return None

    remaining = daily_cap(limit_obj, user_id) - committed_debit(user_id)
    if remaining < 0:
        remaining = 0.0
    return remaining


def lots_left(user_id):
    """Lots today's cap still allows, or None when the user is not metered."""
    limit_obj = active_limit(user_id)
    if limit_obj is None:
        return None

    left = limit_obj.max_lots_per_day - committed_lots(user_id)
    if left < 0:
        left = 0
    return left


def allowed_lots(user_id, price, lots):
    """How many of `lots` lots the budget allows at `price`.

    Zero means nothing may be sent: the caller places no order at all rather
    than falling back to a single lot.
    """
    limit_obj = active_limit(user_id)
    if limit_obj is None:
        return lots

    allowed = min(int(lots), limit_obj.max_lots_per_order)

    #whatever the day has already placed comes off the day's lot cap
    lots_left_today = limit_obj.max_lots_per_day - committed_lots(user_id)
    if lots_left_today < allowed:
        allowed = lots_left_today

    if allowed < 1:
        return 0

    lot_debit = order_debit(price, 1)
    if lot_debit <= 0:
        return 0

    remaining = daily_cap(limit_obj, user_id) - committed_debit(user_id)
    affordable = int(math.floor(remaining / lot_debit))
    if affordable < allowed:
        allowed = affordable

    if allowed < 1:
        return 0
    return allowed


def commit_order(user_id, order_id, price, lots):
    """Hold the debit of a placed order against today's cap."""
    if order_id is None or active_limit(user_id) is None:
        return None

    commitment_obj, created = BotRiskCommitment.objects.update_or_create(
        order_id = f"{order_id}",
        defaults = {
            'user_id': user_id,
            'trade_date': trading_day(),
            'debit': order_debit(price, lots),
            'lots': int(lots),
            'created_at': timezone.now(),
        }
    )
    return commitment_obj


def release_day(user_id, day = None):
    """Drop everything the user holds against `day`, today by default."""
    if day is None:
        day = trading_day()
    BotRiskCommitment.objects.filter(user_id = user_id, trade_date = day).delete()


def release_order(order_id):
    """Give a cancelled order's debit back. Cancelling twice gives it back once."""
    if order_id is None:
        return
    BotRiskCommitment.objects.filter(order_id = f"{order_id}").delete()


def stop_bot(user_id):
    """Switch Bot1 off for the user, so the run stops asking for more."""
    try:
        bot_obj = Bot.objects.get(botname = 'Bot1')
    except Bot.DoesNotExist:
        return
    except Bot.MultipleObjectsReturned:
        bot_obj = Bot.objects.filter(botname = 'Bot1').order_by('id').first()

    BotOnOff.objects.update_or_create(
        bot_id = bot_obj.id,
        user_id = user_id,
        defaults = {'status': False, 'created_at': timezone.now()}
    )


def record_skip(user_id):
    """Tell the user why nothing was sent, and stop the bot for them."""
    UserMessage.objects.create(
        user_id = user_id,
        message = SKIP_MESSAGE,
        created_at = timezone.now(),
    )
    stop_bot(user_id)


def usage_records():
    """One row per user for the admin page: cap, lots, what today has spent."""
    records = []
    user_objs = User.objects.all().order_by('id')
    for user_obj in user_objs:
        try:
            limit_obj = BotRiskLimit.objects.get(user_id = user_obj.id)
        except BotRiskLimit.DoesNotExist:
            limit_obj = None

        if limit_obj is None:
            cap_type = CAP_FIXED
            daily_debit_cap = 0.0
            cap_percentage = 0.0
            max_lots_per_order = 0
            max_lots_per_day = 0
            enabled = False
            cap = 0.0
        else:
            cap_type = limit_obj.cap_type
            daily_debit_cap = limit_obj.daily_debit_cap
            cap_percentage = limit_obj.cap_percentage
            max_lots_per_order = limit_obj.max_lots_per_order
            max_lots_per_day = limit_obj.max_lots_per_day
            enabled = limit_obj.enabled
            cap = daily_cap(limit_obj, user_obj.id) if enabled else 0.0

        committed = committed_debit(user_obj.id)
        remaining = cap - committed
        if remaining < 0:
            remaining = 0.0

        records.append({
            'user_id': user_obj.id,
            'user_name': user_obj.username,
            'cap_type': cap_type,
            'daily_debit_cap': round(daily_debit_cap, 2),
            'cap_percentage': round(cap_percentage, 2),
            'max_lots_per_order': max_lots_per_order,
            'max_lots_per_day': max_lots_per_day,
            'enabled': enabled,
            'committed_lots': committed_lots(user_obj.id),
            'committed_debit': round(committed, 2),
            'remaining_debit': round(remaining, 2) if enabled else 0.0,
        })
    return records
