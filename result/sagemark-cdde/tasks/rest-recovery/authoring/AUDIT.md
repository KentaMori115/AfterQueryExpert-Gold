# rest-recovery — instruction against graded cases, both directions

Run after every edit to either side. Each clause of `instruction.md` has at
least one case; each case rests on at least one clause.

## instruction clause -> cases

| clause | cases |
| --- | --- |
| pools read with `parseHitDicePool`, groups `{ sides, total, spent }`, biggest first, sizes merged, nothing spent | reads a single size; reads a bare die; orders the sizes largest first; merges a size written twice; merges without losing the other sizes; starts every die unspent |
| flat terms, subtracted dice, any modified die and unreadable text throw | refuses a flat number; refuses a die taken away; refuses advantage; refuses disadvantage; refuses keep-highest; refuses keep-lowest; refuses something that is not an expression; refuses an empty sheet entry |
| `availableDice` and `largestAvailable`, null when none are left | counts what is left across sizes; counts nothing left; names the largest size with a die left; names the largest when the pool is untouched; names nothing when every die is gone; names nothing for a pool with no dice |
| `regainDice(pool, count)` unspends biggest first, never past what was spent | unspends from the largest size first; works down the sizes when the largest is whole; hands back no more than were spent; hands back nothing for nothing; leaves a pool that owes nothing alone; unspends the largest dice first |
| `resolveRest(plan, rng)` plan and member fields | every case builds a plan through them |
| the answer carries `kind`, `completed`, `party` and `entries` of `{ id, hpAfter, rolls }`, rolls of `{ sides, rolled, healed }` | reads one entry per member in party order; carries the hit points the member ended on; reads back the kind it was asked for; rolls the largest die first |
| the ledger lists everyone the plan named, even on a night that came to nothing | leaves a short rest under an hour uncompleted; still writes one entry per member, all of it unchanged; leaves a night that broke before the hour was out with nothing; answers with an empty ledger for an empty party |
| a long rest broken over an hour is short, and the hours are read against the rest that was settled on | keeps a rest interrupted for an hour; drops one broken longer to a short rest; settles a night that broke early into a short rest that counts; takes an hour as enough for a night that broke early; leaves a night that broke before the hour was out with nothing; ignores a break on a rest that was short to begin with |
| an hour makes a short rest, eight hours a long one, under that nothing moves | takes an hour exactly as enough; takes eight hours exactly as enough; leaves a short rest under an hour uncompleted; leaves a long rest under eight uncompleted; leaves the slots alone when the hours fall short |
| a short rest spends up to `spendDice`, biggest first, one draw each, roll plus modifier, never under 1, stopping at full health or an empty pool | rolls the largest die first and heals roll plus modifier; marks the dice it spent against the sizes it used; never heals less than one; stops once hit points are full; spends nothing for somebody at full health; spends only what the pool still holds; spends nothing when the sheet asked for none; draws for each member in turn; draws nothing for a member who spends nothing |
| nobody who cannot act spends one | lets nobody who cannot act spend a die; keeps somebody worn to a standstill out of the dice; leaves somebody on nought hit points where they lay |
| long rests spend none, fill hit points and every ordinary slot, and give back `max(1, floor(level / 2))` dice, capped by spending | fills hit points whatever they started at; spends no hit dice and draws nothing; brings every ordinary slot back; hands back half the level rounded down; hands back one die at first level; hands back no more than was spent; unspends the largest dice first; gives every member their own dice back |
| a short rest leaves those slots where they are | leaves ordinary slots where they were; gives a downgraded rest none of its slots back |
| a fed member drops a level of exhaustion on a long rest, never below 0 | walks the track down one for somebody who ate; leaves the track alone for somebody who did not; leaves the track alone on a short rest; never walks below rested; takes one level a night, no more |
| finished rests end frightened and stunned, and unconscious once hit points are above nought | ends fright and a stunning; leaves the conditions a rest cannot touch; wakes somebody whose hit points came back; leaves somebody on nought hit points where they lay; rests a mixed party in one go |

## cases with no clause

None.

## what left the task, and why

- **2026-09-06.** Three cases asserted immutability or a contradiction the
  request never carried, and two more graded an unstated re-sort of a
  hand-built pool. See [[gold-heldout-fixture-order-pins-unstated-normalisation]].
- **2026-09-07, after a second Calibration II at 0 of 8.** Pact slots went
  altogether: the field, the sentence, four cases and the reference's use of
  them. So did "at 6 a rest does nothing at all". The two sat one sentence
  apart and contradicted each other — pact slots came back from *any* finished
  rest, except that one — and resolving that took a reader's judgement rather
  than a reading. Exhaustion 6 still keeps somebody out of the dice, because
  the repository's own `isIncapacitated` says so, which is a fact to be found
  rather than a rule to be told. `easeExhaustion` now walks the whole track so
  nothing in the reference contradicts the shortened text.
