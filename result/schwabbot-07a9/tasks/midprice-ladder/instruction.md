Bot1 replaces a working order three times at the same midpoint, so it never
concedes. Give it a real ladder, in new module `Engine/ladder.py`.

`net_quote(payload, quotes)` returns `(mid, far)` for one payload against a
`get_list_quote` map. A leg whose `instruction` starts with SELL is short, the
rest are long. `mid` values every leg at its own midpoint. `far` values each
leg at the side of its spread paying the account least, shorts at bid, longs at
ask. A `NET_CREDIT` package is worth shorts less longs; anything else, longs
less shorts. Give back `(None, None)` when a leg lacks either side of its
quote, or has no legs.

`ladder_prices(mid, far, steps, tick, credit)` returns the rungs. Rung k of
`steps` sits k/(steps-1) from `mid` to `far`; one step is the midpoint alone.
Every rung lands on the `tick` grid, snapped the way the account would rather
have it: up for a credit, down for a debit. Grid-exact prices stay. Drop any
rung not above zero, and any repeating the one before. Empty list for under one
step, a non-positive tick, or a missing tick, mid or far.

`Bot01Engine.working_ladder(payload, quotes, symbol, steps, width=None)` gives
the prices Bot1 quotes, opening first, on the tick grid for `symbol`; a `width`
drops both ends of the span to a tick under it. Bot1 works that ladder for
real: rung 0 leaves with the opening order, `modify_order_price(signal_info, k)`
replaces at rung k and answers whether a rung was left, and admin setting
`ladder_steps` says how many rungs there are. A balance-sized user takes its
lots from the last rung.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
