# rest-recovery — design sketch (pre-draft)

Written 2026-09-06 while waiting on the draft. Nothing here is final until
Step 0 clears the environment.

## What the repo already says is missing

- `src/core/rules/spell-slots.ts` line 2: "Half casters and pact magic are
  deliberately left for a future chapter."
- `src/features/spell-slots/store.ts` `shortRest()` is an explicit no-op:
  "Short rest does not refill regular slots, but warlocks would here."
- `src/core/rules/conditions.ts` has `bumpExhaustion` and `clampExhaustion`
  and nothing that ever lowers the track.
- `src/core/rules/stat-block.ts` carries `hitDice: string` ('1d8') that no
  module reads.

## Graded surface (dependency free by construction)

`src/core/rules/hit-dice.ts` (new)
- pool shape grouped by die size, parsed out of a `StatBlock.hitDice` style
  string through `core/dice/notation`'s `parseRollExpression`
- spend one die: roll through a `RandomSource`, add the constitution modifier,
  floor at a stated minimum
- recover N dice, largest size first

`src/core/rules/rest.ts` (new)
- `resolveRest(plan)` over a list of participants, returning a ledger entry per
  participant: hp before and after, which dice were spent and what they rolled,
  slots restored, exhaustion before and after
- short rest: hit dice may be spent, pact slots come back, ordinary slots do not
- long rest: hp to max, hit dice back at `max(1, floor(level / 2))` capped by
  the pool, every slot back, exhaustion down one **only** when the character ate
- an interruption over the stated length downgrades a long rest to a short one
- rng draw order is stated: participants in the order given, dice largest first

`src/core/rules/spell-slots.ts` (edited): pact slots as a separate track that a
short rest refills. Existing exports keep their behaviour, `spell-slots.spec.ts`
stays green.

`src/core/rules/conditions.ts` (edited): the way down the exhaustion track,
plus which conditions a completed rest clears.

## Wiring (in the solution patch, never imported by a held-out test)

`src/features/party/store.ts` gains a rest action over the lineup;
`src/features/party/pages/PartyPage.vue` shows the ledger.

## Where the difficulty lives

Interaction, not surface: pool caps against the `max(1, floor(level/2))` floor,
the interruption downgrade landing mid-ledger, the exhaustion gate on rations,
pact slots restoring on the rest that leaves ordinary slots alone, and a draw
order that decides every rolled number. None of it can be checked by the agent
against a shipped test.
