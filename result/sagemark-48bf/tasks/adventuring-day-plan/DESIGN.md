# adventuring-day-plan — what the task turns on, and what grades it

## The gap

`encounter-difficulty.ts` rates one fight against a party frozen at one level,
and `DifficultyCalculator.vue` is its only caller. `leveling.ts` awards, splits
and reads levels off totals; `splitXp` has no caller anywhere in the tree.
Nothing joins them: no day, no allowance across a run of fights, no order.

## Round 1 failed Calibration II at 8 of 8 solved, and why

Everything the plan needed was stated, and stating a thing is handing it over.
The instruction named `assessEncounter`, `levelForXp`, `partyThresholds`,
`splitXp` and `DIFFICULTY_ORDER`, gave the allowance, the leftover rule, the
optimum and its tie-breaks, and the whole task became a specification a careful
reader transcribes. The repository-resident subtleties that were supposed to
carry it — `clampLevel` flooring the mean, `assessEncounter` dropping monsters
worth nothing, `groupMultiplier` shifting on party size — are all things a build
gets right *for free* by calling the function the instruction named. Eight
trials of eight, in nine to seventeen minutes each.

## Round 2: the party is not the roster

One rule replaces the abstract wear ladder, and it is the same shape as the fix
that moved netpen from 7-of-8 to passing: a rule whose content lives in the
repository and whose consequences land in four places at once.

**Whoever `hasDisadvantageOnAttacks` picks out sits the day out.** They stay on
the roster and keep what they hold; they are not counted anywhere the fight is
concerned. Then a fight rated medium or harder tires everybody who was in it by
a step of exhaustion through `bumpExhaustion`, and `hasDisadvantageOnAttacks`
turns over at the third step, so the party thins as the day goes on.

Naming the predicate is not the same as handing the answer over, because the
answer is not a lookup. The head count and the level it feeds are now the
*party's*, not the roster's, and they move mid-day, which lands in four
different places:

| what reads it | what changes |
| --- | --- |
| `partyThresholds` | thresholds scale with head count, so a thinner party rates the same fight harder |
| `groupMultiplier` | tiers shift at two and at six, in the other direction |
| `splitXp` | the denominator, so who is one point short of a level moves |
| `bumpExhaustion` | only the characters who were in it |

And the predicate itself is not the one intuition reaches for. `poisoned`,
`prone`, `restrained`, `blinded` and `frightened` sit a character out;
`unconscious`, `paralyzed`, `stunned`, `petrified` and `incapacitated` do not,
because those are `isIncapacitated`'s list, not this one. A build reasoning from
the tabletop rather than from `conditions.ts` gets three fixtures wrong that
differ from each other by one word.

Three things still move under the plan's feet, and they now fight each other:

1. **The party's level is the mean of the characters' levels, floored.**
   `clampLevel` does the flooring inside `partyThresholds`. Four characters at
   0, 300, 300 and 300 stand at 1.75 and are rated first level.
2. **The leftover `splitXp` hands back is not waste.** It goes a point at a time
   to whoever of the party holds least. One point can lift one character over a
   threshold, move the floored mean and turn a deadly fight into a medium one.
3. **Levelling pulls ratings down; tiring pulls the party apart.** A bag of
   monsters that would end the party at dawn can be a fair fight by noon and out
   of reach again by dusk.

## Fixtures, and what each one splits

| fixture | what it pins |
| --- | --- |
| four at 290, gate watch and two rat nests | deadly at dawn, hard after one trivial fight; one step of exhaustion for the one fight that earned it |
| one of four poisoned, charmed, unconscious, grappled, prone, or three steps tired | six slates identical but for one word: three of them rate the barrow hard on an allowance of 900, three rate it medium on 1200 |
| three characters, one of them poisoned | head count 3 to 2 drops the thresholds and bumps the multiplier at once, and the pair goes from medium to deadly |
| seven characters, two of them down | the crowd knock-down at six disappears at five, and the trio goes from medium to deadly |
| a party staggered at 2, 1, 0, 0 | thins 4 to 3 to 2 across three fights; four different closing totals, three different ratings for the same three picks |
| everybody two steps in | the tiring fight goes last, and the day comes home with 490 instead of 250 |
| everybody three steps in, and the same with one fresh | nobody left takes nothing; one left takes it alone and the multiplier bumps for a party of one |
| a veteran frightened out of it | the same barrow is easy against four and hard against the three novices |
| a table averaging two and a half | floored to the second level row, and two of the four end the day a level up |
| 49 against 48 raw | the leftover carries sela to 300, which lifts the floored mean 2 to 3, which turns the bridge toll deadly to medium |
| six toll posts and a toll of 5, 6 or 7 | the allowance to the point: 1199, 1200 exactly, and 1201 dropping the small one |
| 67 and 66 against 67 and 65 | 199.5 rounds onto the medium line and tires everybody; 198 does not |
| four twins, three fights of room | the earlier slate picks go, and the fourth never does |
| camps worth nothing | a day that stops is shorter than a day that walks into an empty camp |

## The battery

Twenty-nine mutations, every one caught; the weakest loses two of the 110
graded cases. Run `python3 mutants.py`.

| mutation | cases lost of 110 |
| --- | --- |
| the roster hands back the totals it opened with | 33 |
| conditions ignored, the whole roster fights | 31 |
| the leftover is dropped | 30 |
| the allowance comes off the hard threshold | 26 |
| eight medium encounters, not six | 26 |
| every fight tires, not just the hard ones | 25 |
| a character is out at two steps of exhaustion | 24 |
| nobody tires at all | 24 |
| the whole roster is rated, split and counted | 22 |
| exhaustion never puts anybody out | 21 |
| the later slate pick wins a tie | 21 |
| the leftover goes to the top of the roster | 20 |
| a fight costs two steps, not one | 19 |
| the head count is the roster, the level is the party | 18 |
| wear starts at hard, not medium | 16 |
| the fights are taken in slate order | 16 |
| the day is rated by what each character takes | 12 |
| the disadvantage set guessed as the incapacitating one | 11 |
| mean of experience, not of levels | 8 |
| monsters worth nothing are counted | 7 |
| the split takes in whoever sat out | 6 |
| the mean level rounded, not floored | 6 |
| the allowance is worked out again every fight | 5 |
| the effective figure is floored, not rounded | 5 |
| everybody tires, even the ones who sat out | 4 |
| the level is the roster's, the head count is the party's | 3 |
| the longer day wins a tie | 3 |
| the biggest fight the party can take goes first | 3 |
| a fight on the allowance is one too many | 2 |

A thirtieth was written and dropped: removing the "nobody is up to it" guard
changes nothing any suite can see, because a fight with nobody in it awards
nothing and the shorter-day tie-break already discards it. The sentence that
would have stated it is out of the instruction for the same reason.

Every expectation was cross-checked against `authoring/reference.py`, an
independent reading of the rules written from the instruction and the
repository's own tables. 750 random scenarios, conditions and starting
exhaustion included, zero disagreements (`authoring/crosscheck.py`).

## The verifier

netpen's harness, hardened after its round-4 quality failure: nothing mutable
leaves the shim, the control surface is claimed once by `run.mjs` before any
dynamic import exists, no prototype dispatch anywhere, and a case that asserts
nothing is failed rather than credited. Three additions this repository needed:
`toMatch`, `toBeInstanceOf`, and `it.each` / `describe.each` with vitest's own
`%s` title filling.

The image does ship `node_modules` (env-log v1 runs `npm ci` and then
`npx vitest run`), and the harness is used anyway: nothing a submission commits
under `/app` can then stand in for the framework that decides what a case
reports.

| case | reward | f2p | p2p |
| --- | --- | --- | --- |
| base | 0 | 0/110 | 303/303 |
| oracle | 1 | 110/110 | 303/303 |
| alt-shape (one file, a class, plans ranked by a sort key) | 1 | 110/110 | 303/303 |
| edit-base-test (party size shift removed, shipped spec rewritten) | 0 | 0/110 | 298/303 |
| forge-report (patches `process.stdout.write`) | 0 | 0/110 | 303/303 |
| harness-forge (rewrites `Array.prototype`, claims the shim) | 0 | 12/110 | 303/303 |
| kill-runner (`process.exit(0)` at import) | 0 | 0/110 | 303/303 |
| plant-held-out (commits its own `tests/checks/day-that-holds.spec.ts`) | 0 | 12/110 | 303/303 |

## Round 3: the instruction was describing the wrong rule

Round 2 scored 0 of 8, below the band, every trial completing in ten to
seventeen minutes. Nothing timed out and nothing crashed, which rules out
scope: eight builds all arrived somewhere, and all eight arrived somewhere
wrong.

The platform API was behind a Vercel checkpoint for the whole diagnosis, so
none of the trial reports could be read. The reading was taken locally
instead. `variant.ts` is a second implementation of the whole feature written
from the instruction alone, sharing nothing with the reference but the
repository's own functions, and carrying a knob for each way a sentence of the
instruction can be read. With every knob off it passes 110 of 110, so the
specification is realisable. Turned on one at a time:

| reading | f2p lost |
| --- | --- |
| membership fixed at dawn | 15 |
| tire before paying out | 19 |
| head count over the roster | 18 |
| tiring starts at hard | 16 |
| whole leftover to one character | 15 |
| greedy rather than best day | 14 |
| leftover round the table in roster order | 13 |
| mean level over the roster | 12 |
| allowance off the roster | 8 |
| mean level rounded before the tables read it | 6 |
| `spent` counts raw experience | 4 |
| tiring reaches the characters who sat out | 4 |
| longer day wins the tie | 3 |
| the allowance has to be cleared, not met | 2 |

A day is solved only when all 110 pass, so a build has to clear every row at
once. Eleven of the fourteen are stated outright in the instruction and are the
difficulty the task is for. Three were not.

The worst of them was not underspecification but a false statement. "Whoever
`hasDisadvantageOnAttacks` picks out sits the day out" says the party is
settled at dawn. It is not: a medium fight tires everybody in it, the third
step of exhaustion is itself a disadvantage on attacks, so the party thins
between fights and the head count, the mean level and the divisor move with
it. A build that followed the sentence as written lost fifteen cases before it
started, which is enough to explain 0 of 8 on its own.

Three edits, and nothing else in the bundle moved:

- "sits the day out" became "sits that fight out, and the question comes round
  again before each one".
- "split among and tired by" became "split among, and tired by once it is paid
  out", which fixes the order the 19-case row turns on.
- "the party that started it" became "the party the day opened on", so the
  allowance is read off the characters who were up to a fight at dawn rather
  than the roster.

The other eleven readings stay exactly where they were. 297 words.
