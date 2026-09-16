# sheave — rope-bounce (session mindriftwork-dd, tree result/sheave-bd4f)

Repo: sheave, `snapshot.borrower-v2-g1788604137581395`. TypeScript, vitest 2.1.8,
typescript 5.7.2, zero runtime dependencies. Base suite 351 tests over 16 files,
green.

## Claim

**Task name:** `rope-bounce`   **Category:** `feature_request`

The gap is the one the README and `docs/where-the-numbers-come-from.md` both
name: "rope dynamics of any kind, the longitudinal bounce that makes a deep
winder's rope a spring with a period of its own".

Changed-file set (reserved in `result/sheave-SLATE.md`):

| file | added |
| --- | --- |
| `src/rope/dynamics.ts` (new) | 257 |
| `src/rope/shock.ts` (new) | 196 |
| `src/cli/commands/bounce.ts` (new) | 151 |
| `src/winder/model.ts` | 110 |
| `src/winder/audit.ts` | 34 |
| `src/design/checks.ts` | 12 |
| `src/rope/index.ts`, `src/cli/commands/index.ts`, `src/cli/main.ts` | 5 |

765 added, 2 removed, churn 767, 9 files.

Not touched: `src/index.ts`, `src/safety/`, `src/winder/parse.ts`, `src/air/`,
`src/cycle/`, `src/works/`, `src/costing/`, `src/cage/`.

## Peers on this repo (four slots, all taken, none duplicated)

| session | tree | task | core |
| --- | --- | --- | --- |
| mindriftwork-dd (this) | `sheave-bd4f` | `rope-bounce` | rope longitudinal dynamics |
| mindriftwork-bb | `sheave` | `brake-capacity` | the post brake as a mechanism |
| mindriftwork-53 | `sheave-vent` | `ventilation-duty` | shaft resistance and fan duty |
| mindriftwork-57 | `sheave-1f04` | `decking-time` | standing time from the loading arrangement |

Overlaps settled hunk by hunk: my audit finding lives inside `ropeFindings()`
and `brake-capacity`'s on the safety side; my `model.ts` change is accessors
appended at the end, no existing function edited; `parse.ts` is
`brake-capacity`'s alone.

## What the feature is

A rope is a spring. `hang({rope, length, ropes, carried, balance})` is a length
of rope from the sheave with something on the end of it, and off one hang come
`springRate`, `wholeStretch`, `bounceMass`, `bouncePeriod`, and from a
retardation `peakPull`, `leastPull`, `goesSlack` and `shockFactor`. On a winder,
`hangAt(winder, up)` and `worstShock(winder)` say where in a wind an emergency
stop is worst. It reaches the sheet as a `stop` design check floored at
`DEEPEST_FACTOR` and as a finding in the rope's part of the audit, and the
command line gets `sheave bounce`.

The difficulty is not the physics, which is a first-year formula. It is which
mass goes into which formula, and it collides with an invariant the base suite
already pins:

- the winding rope's own mass counts **once** in the static pull and **a third**
  of a time in the swinging mass;
- the balance rope counts **in full** in both, because it hangs from the
  conveyance rather than from the sheave;
- so a balanced winder is hardest on its rope **at the bank** and an unbalanced
  one **at the pit bottom**. Bolsover and Zollverein carry balance ropes and
  come out at the top of the wind; Wheal Jane carries none and comes out at the
  bottom. That flip is the derived result and no fixture states it.
- the floor has to be `DEEPEST_FACTOR` (4.5) and not 5: `test/design.test.ts`
  asserts `failed(checks(bolsover))` is empty and Bolsover's worst stop is
  4.704. A floor of 5 breaks a base test.
- `worstShock` walks on the pull rather than on the rounded factor. Ranking on
  `shockFactorAt` ties across the last two metres of the wind at three decimal
  places and the reported `up` was non-deterministic.

## Held-out tests

`test/pit/`, four files, 749 lines, 110 cases.

| file | cases |
| --- | --- |
| `hanging-rope.test.ts` | 40 |
| `stopped-wind.test.ts` | 26 |
| `three-collieries.test.ts` | 22 |
| `signing-off.test.ts` | 22 |

Named off the fixtures and put in a subdirectory rather than at
`test/dynamics.test.ts`, which is where an agent's own tests would land.

Band: held-out 749 lines against churn 767. Floor is 0.93 x 767 = 713.3, ceiling
is the solution's 765 added. Inside both.

f2p 110, p2p 351.

## Verified locally

- base + solution + held-out: **461 of 461 pass** (351 base, 110 new).
- base + held-out only: **0 of 110 f2p pass**, **351 of 351 p2p pass**.
  Seven cases passed at base on the first cut and were each strengthened:
  a `.toThrow()` on a function that does not exist yet throws a TypeError and
  passes; `bands({stop: 6})` at base silently drops the key; and every
  "nothing got worse" assertion is vacuously true before the feature exists.
- `tsc --noEmit` clean, `structure.test.ts` (the repo's own layout rules) green.

## Instruction

295 words, inside the 100 to 300 band. Detector clean: no em dash, no en dash,
no curly quotes, no register words. Ends on the exact commit line.

Bidirectional audit run as a script, both directions clean: every symbol the
graded cases touch that is not in the base checkout is named in the
instruction, and every name the instruction states has at least one graded case.

## Step 0, run 2026-09-06

Repo id `5nRrumZDTQjziGuDCqrn`, env v1, base
`bb4eda665b5ba5e281155e94d4c72fee12ef2797`, image
`gold-repo-sheave-5nrrum:v1`. The generator's ten steps:

```
FROM node:24-bookworm-slim
install git
COPY repo/ /app
WORKDIR /app
npm install --no-save --no-package-lock typescript@5.7.2 vitest@2.1.8 @types/node@22.10.2
assert tsc is 5.7.2
assert the three module versions
rm -f /app/package.json /app/package-lock.json
git safe.directory /app, core.hooksPath /dev/null
```

So the dependencies ARE installed, unlike account-updater. The image was
rebuilt locally from those lines and the base suite run inside it with
`--network none`, which is the only way the next fact turns up: **one base case
cannot pass in this image.** `test/structure.test.ts > what the library will
not do > has no runtime dependencies at all` reads `package.json`, which step
nine deletes, and gets ENOENT. It is left off the p2p whitelist. **350, not
351.** The file's other thirteen cases stay, and they are the ones that hold
the new module to the repository's own layout rules.

`node_modules` is gitignored, so nothing a submission does to it reaches the
verifier: `model.patch` is a git diff. The attack surface is tracked files.

## Verifier

`make_test_sh.py` rebuilds `tests/test.sh` from the frozen frame and asserts
the bytes outside the markers never moved. The harness is the hardened Node
one from `result/cloudvault-74ab/tasks/ranged-downloads/harness`, with
`toBeInstanceOf` and `expect.unreachable` added for this suite:

- the runner lives outside `/app`, root-owned 0444 in a 0555 directory, and
  runs as `nobody` through `setpriv`;
- it drives the TypeScript with `node --experimental-transform-types`, so the
  repository's own installed vitest never decides what a case reports;
- the per-run token is written to a root-owned 0700 directory, handed over as
  an already-open descriptor and never through argv or the environment, and the
  child closes it before the first repository module loads;
- the shim exports no mutable state, hands its control surface to the first
  claimant only, dispatches every builtin through `Reflect.apply`, and **fails
  a case that asserted nothing**;
- a python3 publisher that never imports repository code holds the whitelist
  and publishes every declared id, failing any the stream missed, duplicated or
  sent after the closing line;
- `/tests` is chmod 0700 for the length of the run;
- the 16 shipped suites and `vitest.config.ts` / `tsconfig*.json` are restored
  from the base commit before anything runs.

## Verified against the real image

| run | result |
| --- | --- |
| solution applied | reward **1.0**, f2p 110/110, p2p 350/350 |
| base, nothing applied | reward **0**, f2p 0/110, p2p 350/350 |

Attack matrix, every row applied to the base tree with no solution, all must
grade 0:

| row | reward | f2p | p2p |
| --- | --- | --- | --- |
| prototype-rewrite (rewrites `Array.prototype.push/slice/concat`, claims the shim off disk) | 0 | 0/110 | 219/350 |
| globals-swap (a quieter `expect`/`describe`/`it` on globalThis) | 0 | 0/110 | 350/350 |
| forge-report (writes passing JUnit to both report paths) | 0 | 0/110 | 349/350 |
| steal-token (hunts `/proc`, the environment and fd 0, prints forged verdicts) | 0 | 0/110 | 349/350 |
| edit-base-suite (neuters a shipped suite's assertions) | 0 | 0/110 | 350/350 |
| edit-graded-suite (writes its own file at a held-back path) | 0 | 0/110 | 350/350 |
| empty-bodies (real titles, bodies that assert nothing) | 0 | 0/110 | 350/350 |

`edit-base-suite` still reads 350/350 because the shipped suites are restored
from the base commit before the run.

Mutation battery, `local/mutants.py`: **18 of 18 caught.** Every promise the
instruction makes is enforced somewhere, including the two that are only
reachable through interaction (the balance rope swinging in full, and the
worst-rope allowance on a multi-rope set).

## Rounds

| round | pushed | verdict |
| --- | --- | --- |
| 1 | 07:07 | qualityCheck **fail**: behavior in task description, implementation acceptance breadth, instruction self containedness |
| 2 | 07:21 | qualityCheck **fail**: behavior in tests |
| 3 | 07:43 | qualityCheck **pass**, Calibration I **pass** (0 of 5), Calibration II **out_of_band_hard** (0 of 8) |
| 4 | 08:34 | running |

ciChecks, aiCheck, originality and reference verification have passed on every
round. The one standing warning is the instruction at 298 words against a
recommended 250; the band is 100 to 300 and the graded surface does not fit in
250 without dropping a stated rule, which fails a blocking check instead.

### Round 1: the tests graded my implementation's shape

Three criteria, one defect. The cases asserted that `hang` defaults `ropes` to
1 and `balance` to 0 when they are left out, that `hangAt` and the stop
functions reject bad input, and that `worstShock` reports a whole-metre
position. None of that is behaviour the request asks for.

Fixed by shrinking what is graded rather than growing the spec: every
`hang({...})` in the graded suite now names all five fields, the two rejection
cases are gone, and the worst-point assertions are positional (within a metre
of the bank, under a metre of the pit bottom) rather than exact. The case that
called `worstShock` with a second argument was grading an override parameter
the request never mentions, so it now checks which brake was used instead.

`hangAt`'s balance rope length was graded and unstated too, same defect class,
and it is the hinge the feature turns on, so that one was **stated** rather
than dropped.

### Round 2: the command was promised and never specified

`behavior_in_tests`: the instruction promised a `bounce` command and said
nothing about what it does, so the cases could only check that it existed. The
instruction now specifies it and three cases grade it, reading the sheet by
what a line is about and what unit the number carries, never by where it sits.

**One real bug caught by running the verifier rather than trusting vitest.**
Cutting cases to get back inside the line band left a `describe` with nothing
in it. Vitest emits a testcase for an empty describe and the custom harness
does not, so the id went into `config.json` and graded as "no verdict
reported": the reference run scored **95 of 96** and reward 0. Local vitest was
green throughout.

### Round 3: 0 of 8 was three unstated contracts, not difficulty

No id failed in all eight trials, and the best trial failed **2 of 95**. That
is a spec gap, not a difficulty signal. Tallying the eight `new_junit.xml`
reports by how many trials failed each id gave three clusters:

| trials | cluster | what was unstated |
| --- | --- | --- |
| 7 of 8 | everything about `hangAt`'s rope | the rope runs from the **sheave**, so it is `ropeWanted` less `up`, not the depth less `up` |
| 6 of 8 | the balance rope on a `hangAt` | the field is kilograms, so it is `balance*up` and not `up` |
| 5 of 8 | the `bounce` sheet | whether `--length` takes a unit at all |
| 3 of 8 | the audit finding | that it is an **error** past the floor |

Fixed in the instruction for the first, second and fourth. The third is not the
request's business either way, so the graded case now tries `--length 984m` and
falls back to `--length 984`, and whichever the build takes is the one read.

## Verified against the real image, round 4

| run | reward | f2p | p2p |
| --- | --- | --- | --- |
| solution applied | **1.0** | 95/95 | 350/350 |
| base, nothing applied | **0** | 0/95 | 350/350 |

- attack matrix: **7 of 7 held at 0**
- mutation battery: **20 of 21 caught**
- acceptance battery: **6 of 6 accepted**

### The one surviving mutant, and why it stays

Replacing the headline factor row of the sheet with a constant leaves a second,
correct factor figure elsewhere on it, so the comparison still sees something
move. Catching it would mean demanding that every factor figure on a sheet be
the computed one, which would reject a legitimate sheet that also prints the
floor it is judged against. The mutation produces a sheet that contradicts
itself, which is not a failure mode a real build has.

### The acceptance battery

Built the feature six other ways and re-ran the graded cases against each. All
six are legitimate readings of the same request and all six score:

- `worstShock` solved analytically, reporting a real position rather than a
  floored walk
- `hang` with no defaults, every field required
- nothing checking its arguments at all
- `hangAt` taking any position without complaint
- a `bounce` sheet worded and ordered another way
- a `bounce` command whose `--length` is a bare number

The first four are the implementations round 1's reviewer said would be
rejected.

## Pushed and submitted 2026-09-06 07:07
## Pushed and submitted 2026-09-06 07:07

Draft `iCNw21GxNBrHbgrEIugA`. `gold_bot.py check` clean on every floor.

| gate | verdict |
| --- | --- |
| ciChecks | passed |
| aiCheck | passed |
| similarity | passed |
| oracleNop | running |

One non-blocking ciChecks warning: instruction is 295 words against a
recommended 250. The band is 100 to 300 and the graded surface will not fit in
250 without dropping a stated rule, which is the worse failure.

## Round 4 — PASSED all 8 stages (2026-09-06)

Draft `iCNw21GxNBrHbgrEIugA`, submitted 08:32, terminal **Needs Review** (human queue)
at 13:19 UTC. Every gate green:

| stage | verdict |
| --- | --- |
| ciChecks | passed (1 warning: instruction 298 words vs 250 recommended) |
| aiCheck | passed |
| similarity | passed |
| oracleNop | passed |
| qualityCheck | passed / pass |
| easinessProbe (Cal I) | passed — 0 of 5 solved |
| difficultyProbe (Cal II) | passed |
| failureValidation (run audit) | passed / pass |

Floors all clear: solution 765 lines / 9 files, held-out 746 lines / 4 files,
instruction 298 words, f2p 95, p2p 350, 2.57 lines per word.

### What fixed Calibration II

Round 3 was `out_of_band_hard` at 0 of 8, with clusters of 7/8 and 6/8 trials
failing the same ids — unstated contracts, not difficulty. Stating three of them
(the `hangAt` rope length, the balance-rope units, the `bounce --length` form) and
making the fourth tolerant moved the run to a graded spread instead of a wall.

Mid-flight snapshot at 7 of 8 trials, taken before the artifacts were purged:

- rewards: one solve (`task__nSccZAC`, 95/95), rest 0
- f2p passed per trial: 95, 94, 93, 88, 87, 85, 51
- p2p 350/350 in **every** trial — no regressions anywhere
- worst shared failure 4 of 7, on two `signing-off` cases; nothing failed in all
  trials, which is what the run audit wants to see

The lesson from round 3 held: a probe that fails everywhere is a spec gap, and the
cure is to state the contract, never to delete the assertion.
