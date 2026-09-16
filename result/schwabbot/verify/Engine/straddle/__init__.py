"""The end of a gap-up straddle day.

Bot 2's short premium structures are entered with a profit target and no plan
for a target that never fills.  ``clock`` measures what is left of the
session, ``entries`` remembers what each user is holding, ``ticks`` puts a price on the grid in whichever direction the money
is flowing, and ``plan`` turns a live entry plus the current quotes into the
one decision the bot has to make: hold, or get out.
"""

from Engine.straddle.clock import (
    EXIT_CUSHION_MIN,
    EXIT_SWEEP_MIN,
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    in_market_time,
    market_timezone,
    minutes_to_close,
)
from Engine.straddle.entries import live_entries
from Engine.straddle.plan import (
    CLOSE,
    CLOSING_INSTRUCTION,
    HOLD,
    buyback_order,
    closing_legs,
    exit_plan,
)
from Engine.straddle.ticks import snap_down, snap_up, tick_size

__all__ = [
    'CLOSE',
    'CLOSING_INSTRUCTION',
    'EXIT_CUSHION_MIN',
    'EXIT_SWEEP_MIN',
    'HOLD',
    'MARKET_CLOSE_HOUR',
    'MARKET_CLOSE_MINUTE',
    'buyback_order',
    'closing_legs',
    'exit_plan',
    'in_market_time',
    'live_entries',
    'market_timezone',
    'minutes_to_close',
    'snap_down',
    'snap_up',
    'tick_size',
]
