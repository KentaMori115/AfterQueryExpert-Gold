# sheave — session mindriftwork-1f (tree result/sheave-1f04)

Snapshot `snapshots/snapshot.borrower-v2-g1788604137581395.zip`, unpacked 2026-09-06
into `repo/`. Package `sheave` 0.5.0, ESM TypeScript, no runtime dependencies;
devDeps `typescript 5.7.2`, `vitest 2.1.8`, `@types/node 22.10.2`.

Base suite after `npm ci`: **351 tests in 16 files, all green** (`npx vitest run`,
2.3 s). CI also runs `npm run types` and `npm run build`.

## Claim (fourth of four slots on this repo)

| task | category | files |
| --- | --- | --- |
| `decking-time` (proposed) | feature_request | `src/cycle/decking.ts` (new), `src/cycle/index.ts`, `src/works/output.ts`, `src/cli/commands/decking.ts` (new), `src/cli/commands/index.ts`, `src/cli/main.ts` |

The gap: `Profile.rest` is a number somebody types in. Nothing anywhere derives
a standing time from the loading arrangement — tubs a deck, decks a cage, the
re-decking move between decks, a skip discharging against a cage being changed,
the fact that a balanced winder stands at both ends at once so the stand is the
longer end and not the sum. The cycle module's own docstring says the standing
time beats every other figure in the wind, and it is the one figure the library
takes on trust.

Interaction that carries the difficulty: decks buy payload and cost standing
time, so winds an hour falls as tonnes a wind rises, and where the optimum sits
moves with depth — deep shafts want more decks, shallow ones fewer. That runs
through `cycle.windsAnHour`/`tonnesAnHour`, `works.betweenArrivals`,
`works.bunkerFor` and the cost per tonne.

## Other sessions on this repo (all four slots claimed, none duplicated)

- `result/sheave` (mindriftwork-bb) — `brake-capacity`: safety/brake.ts, winder
  parse/model/audit, design/checks, cli brake.
- `result/sheave-bd4f` (mindriftwork-dd) — `rope-bounce`: rope as a longitudinal
  spring, under `src/rope/`, plus one band in design/checks and a hunk inside
  `ropeFindings()` in winder/audit.
- `result/sheave-vent` (mindriftwork-53) — `ventilation-duty`.
- this tree — `decking-time`. Slate written up in `result/sheave-SLATE.md`.

Kept clear of both: nothing of mine lands in `src/rope/`, `src/safety/`,
`src/winder/` or `src/design/`. Shared registration lines in `src/cli/main.ts`
and `src/cli/commands/index.ts` are unavoidable for any new command.

## Size

`gold.me` on this seat: solution 459 added lines over 4 files, held-out 596 over
2 files, instruction 100 to 300 words, f2p 8 (warn under 20), p2p 50. The
held-out patch is banded at `[0.93 x (added + removed), added)`, so a 596 line
floor forces the solution past roughly 640 added lines before a legal held-out
patch exists at all. Target: about 700 added implementation lines, removals near
zero, held-out about 620.

Where they come from:

| file | new? | about |
| --- | --- | --- |
| `src/cycle/decking.ts` | new | the stand: decks, the re-decking move, both ends at once |
| `src/cycle/arrangement.ts` | new | how a conveyance is loaded and discharged, and what each costs in seconds |
| `src/cage/conveyance.ts` | no | tubs a deck (today `tubsIn` ignores `decks`), deck pitch, what a deck holds |
| `src/works/output.ts` | no | arrivals, bunker and the shift change off a derived stand |
| `src/costing/works.ts` | no | what standing time costs a tonne |
| `src/cli/commands/decking.ts` | new | `sheave decking` |
| `src/cycle/index.ts`, `src/cli/commands/index.ts`, `src/cli/main.ts` | no | registration |

## Step 0

Not run: no task exists on this repo yet, so there is no repo id to read `envs`
and `env-log` from. It runs the moment a draft exists. This is a TypeScript repo
whose suite needs `vitest`, so the answer matters — see the offline Node verifier
machinery used on webdevium/cloudvault if the platform image installs nothing.

## Build log

Draft `XK2or0zB11qNuvT5D4OJ` (`decking-time`, category `feature_request`), repo
`5nRrumZDTQjziGuDCqrn`, base `bb4eda665b5ba5e281155e94d4c72fee12ef2797`,
environment v1.

**Step 0 (proven, not read).** The image is `node:24-bookworm-slim` + git +
`COPY repo/ /app` + `npm install --no-save --no-package-lock typescript@5.7.2
vitest@2.1.8 @types/node@22.10.2`, then **`rm -f /app/package.json
package-lock.json`**, then git safe.directory. Rebuilt locally from those exact
lines and run with `--network none`: 350 of 351 base cases pass. The one that
cannot is `test/structure.test.ts > what the library will not do > has no
runtime dependencies at all`, which reads the deleted `package.json`. Its id is
left out of the p2p whitelist; the file still runs, so its other thirteen cases
are graded.

**The change.** `src/cycle/decking.ts` (new, 383 lines) works the standing time
out of the landing: a deck's tubs at so many seconds each, the lift of a deck's
pitch at creep speed and the keps between decks, a skip's discharge whatever its
decks say, nothing at all for a counterweight, and the winder waiting for the
slower of its two landings rather than the two added. Then the trade: decks buy
payload and cost seconds, a cage is tared on the coal its decks were built for
whether the rope fills them or not, and `payloadAllowed` decides what actually
goes on. `src/cli/commands/decking.ts` (new) prints it, with the three
registration lines making up the rest.

**Numbers.** solution +671 over 5 files; held-out +641 over 2 files (band
[624, 671), floor 596); instruction 296 words; f2p 94; p2p 350; 2.27 solution
lines a word.

**Verified in the verifier mirror** (`local/verify_task.sh`, the real
`tests/test.sh` in the environment image plus python3):

- reference solution: reward 1, f2p 94/94, p2p 350/350
- base tree: reward 0, f2p 0/94, p2p 350/350, every declared id present

**Attack matrix** (`local/attack_matrix.sh`, 12 rows, all as expected): a chai
tamper reaching the graded suite scores 0 (the suite's own judging cases catch
it), a report forgery scores 0, a survivor process scores 0 effect, a committed
`node_modules` or `.npmrc` is refused, and edits to base tests, fake held-back
files, a rewritten vitest config and a renamed suite are all neutralised and
still score 1.

**Mutation battery** (`local/mutants.py`, 18 rows): every stated rule dies when
broken. Two survivors on the first run were both my own fault and both fixed:
the `withDecking` case compared against a default profile, so a profile that
dropped its other figures passed, and the tie rule in `bestDecks` had no case
that could reach a tie, so the clause came out of the instruction rather than
staying there ungraded.

## Rounds

**Round 1 (submitted 07:37).** ciChecks, aiCheck, originality, reference
verification, quality review and Calibration I all passed. Calibration II failed
`out_of_band_hard`, 0 of 8 solved. Reading all eight trial reports rather than
the number: five trials failed only four or five cases of 445, and the ids
repeated. They were edge behaviour the instruction never stated, not difficulty.

| id | trials failing | verdict |
| --- | --- | --- |
| `worthOfADeck` refuses a seventh deck | 8 of 8 | unstated, case removed |
| `standingADay` in hours | 1 (returned minutes) | unit now stated |
| `decking()` refuses settle or discharge of nought | 4 | see round 2 |
| `redecking`/`deckPayload` refuse more than six decks | 2 | unstated, removed |
| `decksAllowed` refuses a rope too slack for one deck | 2 | unstated, removed |

Three trials failed 34 to 36 cases with NaN and undefined: argument order against
signatures the instruction spells out. Those are the difficulty and they stay.

Quality review also left an `environment_cleanliness` finding: the verifier ran
with the image's deleted `package.json`, so one base case could never pass. The
verifier now restores `package.json` and `package-lock.json` from the base commit
along with the test tree and the tooling, the base suite is 351 of 351 green, and
all 351 ids are declared. Two smaller repairs: the report writer keeps each case's
real failure message (round 1 published one generic line, which is why the first
diagnosis needed `run.log`), and three test titles that echoed instruction
sentences were renamed.

**Round 2 (submitted 08:29).** Failed `quality_check: behavior_in_tests`, and the
finding was exact: the instruction said the decking figures refuse nought or less
while the tests no longer enforced that for `settle` and `discharge`. Relaxing the
tests without relaxing the promise is what caused it.

**Round 3.** Instruction, tests and reference now say the same thing. `decking()`
refuses a negative anywhere, a tub time or a pitch of nought, and part of a tub;
a settling or a discharge of nought is allowed, which is what a tippler under the
headgear buys. The reference was relaxed to match, and there is a case for each
half of that contract.
