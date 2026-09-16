Camping is the one thing sagemark cannot do: `longRest` gives every slot back at once, a short rest nothing, exhaustion only climbs, `hitDice` goes unspent.

Start with the dice. New `src/core/rules/hit-dice.ts` reads `5d8` or `2d10+3d6` through `parseHitDicePool`: one `{ sides, total, spent }` per size, biggest first, sizes merged, unspent. Flat terms, subtracted dice, any modified die and unreadable text throw. `availableDice` and `largestAvailable`, null when none are left, read a pool; `regainDice(pool, count)` unspends biggest first, never past what was spent.

Then the camp. `resolveRest(plan, rng)` in `src/core/rules/rest.ts` reads a `kind`, its `hours`, the `breakMinutes` that broke it, a `party` carrying `id`, `level`, `hp`, `hpMax`, `conModifier`, `hitDice`, `slots`, `conditions`, `fed` and `spendDice`. Back come the `kind` it settled on, whether it `completed`, the `party` afterwards, and `entries` per member in order, with `id`, `hpAfter` and `rolls` of `{ sides, rolled, healed }`. The ledger lists everyone the plan named, even on a night that came to nothing.

A long rest broken over an hour is short, and the hours are read against the rest that was settled on rather than the one that was asked for. An hour makes a short rest, eight hours a long one; under that nothing moves. A short rest spends up to `spendDice` dice, biggest first, one draw each through `core/dice/roll`, healing roll plus modifier, never under 1, stopping at full health or an empty pool. Nobody who cannot act spends one. Long rests spend none, fill hit points and every ordinary slot, and give back `max(1, floor(level / 2))` dice, capped by spending. A short rest leaves those slots where they are.

A fed member drops a level of exhaustion on a long rest, never below 0. Finished rests end frightened and stunned, and unconscious once hit points are above nought.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
