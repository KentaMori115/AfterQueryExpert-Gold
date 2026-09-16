Bot 2 opens gap-up structures with a profit target underneath and forgets them.

Give it an ending, in a new `Engine.straddle` package.

`closing_legs(entry)` turns an entry's own legs around, `SELL_TO_OPEN` into `BUY_TO_CLOSE` and `BUY_TO_OPEN` into `SELL_TO_CLOSE`, keeping quantity, instrument and order. Child strategies are not part of it. Any other instruction, no quantity or no legs gets None, as does anything built on it.

`buyback_order(entry, quotes, symbol)` prices them at the touch: buying back pays `askPrice`, selling back takes `bidPrice`. Positive net is a `NET_DEBIT` rounded down to that symbol's tick, negative net a `NET_CREDIT` priced at what it collects, rounded up. A leg nobody quotes sends it `MARKET` with no price.

`exit_plan(entry, quotes, symbol, minutes_left)` answers with `action`, `cancel_child`, `order`. Over ten minutes, or no clock, is `hold`, nothing else. Ten or fewer is `close` at the touch, none left is `close` at market. `cancel_child` holds whether the entry carried a target.

`Bot02Engine.remember_live_entries(signal_info)` keeps what a run leaves open in `live_entries`, keyed by user: skip lots at or below zero, write each user's size into every `payload` leg, hold the group's `trading_symbol`, and `order_id` from `order_result_dict` or None. `check_exit(now)` plans each and hands them back; a close pulls the target, sends the closing order and drops the entry. `Bot02Manage.Run` arms one repeating job first thing, before its weekend and readiness checks can return; the job sweeps the engine and stops once nothing is left open.

`Engine.offline` books each target as its own `WORKING` order, `offline working`, listed by `paper_child_orders` as rows with `order_id`, the caller still hearing the entry's id. Cancelling an entry cancels them, cancelling one leaves it alone. Summaries nest them in `child_orders`, same shape.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
