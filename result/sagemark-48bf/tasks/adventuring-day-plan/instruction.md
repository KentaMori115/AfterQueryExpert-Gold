Sagemark rates one fight at a time, never a day. A new `src/core/rules/day-plan.ts` should export `planAdventuringDay({ party, slate })`, party `{ id, xp, state }` in seating order, the `ConditionState` (`active`, `exhaustion`) they woke in, slate the prepared encounters `{ id, monsterXps }`.

Whoever `hasDisadvantageOnAttacks` picks out sits that fight out, and the question comes round again before each one. The rest are the party: what a fight is rated against, split among, and tired by once it is paid out.

Rate one through `assessEncounter`, handed their head count and the mean of the levels `levelForXp` reads off them. A fight rated deadly is one the party will not take. One rated medium or harder tires everybody in it by a step, through `bumpExhaustion`.

The day carries an allowance: six times the medium threshold `partyThresholds` gives the party the day opened on, worked out then and never again. A fight fits while the spend including it stays at or under it.

A fight's raw experience goes through `splitXp`: the even share to everyone in it, then the leftover a point at a time to whoever holds least, earliest on the roster first.

Give back the day that leaves the roster richest, then the shorter, then the one reaching for the earlier slate pick, fight by fight.

The plan carries `entries`, one per fight in the order run, each `{ pickId, difficulty, rawXp, effectiveXp }` as it stood when they walked in; `allowance`; `spent`, the effective experience it cost; `gained`, what the whole roster put on; and `party`, the roster in order with closing `xp`, `level` and `state`. An empty roster or a repeated id is a `ValidationError` from `lib/errors`.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
