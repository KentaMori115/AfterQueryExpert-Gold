# sheave — colliery winding arithmetic (TypeScript, vitest)

Snapshot: `snapshots/snapshot.borrower-v2-g1788604137581395.zip`, unpacked 2026-09-06.
Package `sheave` 0.5.0, ESM TypeScript, no runtime dependencies; devDeps are
`typescript 5.7.2`, `vitest 2.1.8`, `@types/node`.

Base suite at the snapshot: **351 tests in 16 files, all green** (`npx vitest run`,
after `npm ci`). `npm run types` and `npm run build` are the other two CI steps.

## Shape

`src/` 8247 lines over 14 namespaces, exported from `src/index.ts` in the order
the load travels: `units rope shaft drum cage cycle power safety winder design
costing works report cli`. 17 CLI commands under `src/cli/commands/`. Two docs:
`docs/winder-file.md` (the `.winder` file format and its keywords) and
`docs/where-the-numbers-come-from.md` (facts / regulation / fitted / practice).

## Task slate (repo caps at 4 active)

| task | files reserved | state |
| --- | --- | --- |
| `brake-capacity` | `src/safety/brake.ts`, `src/safety/index.ts`, `src/winder/parse.ts`, `src/winder/model.ts`, `src/winder/audit.ts`, `docs/winder-file.md`, `docs/where-the-numbers-come-from.md`, `README.md`, `CHANGELOG.md` | draft `VbKO7K6KBeGTHvK0HDXH`, **submitted 2026-09-06** |

## Other sessions on this repo

`mindriftwork-dd`, tree `AQ_dragan/result/sheave-bd4f`, holds `rope-bounce`: rope
as a longitudinal spring, `src/rope/dynamics.ts` plus `src/rope/index.ts`,
`src/cli/commands/bounce.ts`. Agreed 2026-09-06 that we share only the four files
any task on this repo has to touch (`src/winder/audit.ts`, `src/design/checks.ts`,
`src/cli/main.ts`, `src/cli/commands/index.ts`) plus one added accessor of theirs
at the end of `src/winder/model.ts`. Their audit finding stays inside
`ropeFindings()`; ours stays on the safety side. `src/winder/parse.ts` is ours
alone, so the `.winder` `brake` keyword is uncontested.

## Step 0, done 2026-09-06

Repo id `5nRrumZDTQjziGuDCqrn`, environment v1, image
`gold-repo-sheave-5nrrum:v1`, base commit `bb4eda665b5ba5e281155e94d4c72fee12ef2797`.

The generator's build steps: `node:24-bookworm-slim`, git, `COPY repo/ /app`,
`npm install --no-save --no-package-lock typescript@5.7.2 vitest@2.1.8
@types/node@22.10.2`, two assertions on the installed versions, then
**`rm -f /app/package.json /app/package-lock.json`**, then git safe.directory
and `core.hooksPath=/dev/null`.

Rebuilt those steps locally and ran the base suite inside the image with
`--network none`: **350 of 351 pass**. The one that cannot is
`test/structure.test.ts > what the library will not do > has no runtime
dependencies at all`, which reads `package.json` and gets ENOENT because the
build deleted it. That id is left off the p2p whitelist. Reading the log alone
would not have shown this.

## Notes

- No brake mechanism anywhere in the tree: `safety/gear.ts` carries only the
  retardation constants (`EMERGENCY_BRAKE`, `WORKING_BRAKE`, brake delay) and
  the overwind/overspeed curve built on them. Nothing computes brake torque,
  brake path, shoe pressure or what a friction winder's ropes do when the brake
  is harder than the wheel can transmit.

## brake-capacity, round 1

Draft `VbKO7K6KBeGTHvK0HDXH`, submitted 2026-09-06 07:31.

The gap: `safety` had three retardation constants and no brake. The task adds
the machine, in `src/safety/brake.ts` and reachable off the `safety` namespace:
torque from the shoes, that torque referred to the rope, the out-of-balance a
wind runs from a least to a most across (both signed, worst the larger by size),
what a friction wheel will pass before the ropes slip, the lesser of shoes and
grip, the holding rule at three times, the shoe force that just holds, the two
retardations winding and lowering, the overwind, and shoe pressure. A `brake`
line on a winder file carries it and the audit files findings under `brake`.

| figure | value |
| --- | --- |
| solution | +624 / -1 over 9 files |
| held-out tests | +601 over 2 files (`test/holding.test.ts`, `test/lowering.test.ts`) |
| instruction | 298 words |
| f2p | 54 |
| p2p | 350 (every base id except the one the image broke) |

### Verifier

The netpen `harvest-schedule` harness, ported: a runner outside `/app` that
takes a per-run token off stdin before repository code loads, a shim standing in
for the slice of vitest these suites use, a claim-once control surface, every
matcher counting itself so a case that asserts nothing fails, and a python3
publisher that never imports anything from `/app` and publishes every declared
id whatever the child did. The child runs as `nobody` under `setpriv` where the
block is root, and degrades to running in place where it is not. Two additions
this repo wanted: `toMatch` and `toBeInstanceOf` in the shim, since the base
suite uses both, and a line that drops any tracked file under `node_modules`
before the runner starts.

### Local battery

    base                   0   0 / 54 f2p, 350 / 350 p2p
    oracle                 1  54 / 54,      350 / 350
    alt-shape              1  54 / 54,      350 / 350
    edit-base-test         0   0 / 54,      350 / 350
    forge-report           0   0 / 54,      349 / 350
    harness-forge          0   0 / 54,      220 / 350
    kill-runner            0   0 / 54,        0 / 350
    plant-held-out         0   0 / 54,      350 / 350

`alt-shape` is a second implementation written from the instruction alone, in a
differently named file, with different internals and no rounding at all. It
scores 1, which is the local stand-in for a calibration trial and the evidence
that the graded suites read behaviour rather than shape.

`mutants.py` puts 25 mistakes into the reference, one at a time: the two
retardation signs, the missing floor at nought, the wheel cap left off, the
capstan ratio read without its margin, the taut side read for the slack, the
worst out-of-balance taken at one end, the holding rule at two rather than
three, pressure over the whole path and pressure left in kilonewtons, torque at
the diameter and torque counting one shoe, the pull referred to the path, the
overwind answered lowering, the force wanted taken from the capped pull, a
brake handed to a sheet that named none, an audit speaking about an unmeasured
winder, the lining's pressure limit in place of the shoe's, and four ways of
reading the file line loosely. **25 of 25 caught.**

## brake-capacity, round 2

Round 1 reached Calibration II and failed there, `out_of_band_hard`, 0 of 8.
Everything before it passed first time: ciChecks, aiCheck, originality,
reference verification, quality review, and Calibration I at 0 of 5.

### What 0 of 8 turned out to mean

All eight trials failed at the same line of the same file, the import of
`leastOutOfBalance`. Pulling every trial's `model.patch` off the run showed four
divergences, three of them unanimous:

| what | the trials | round 1 |
| --- | --- | --- |
| the brake line's first key | `diameter`, 8 of 8 | `path` |
| the three out-of-balance figures | `src/power/duty.ts` off a `Duty`, 8 of 8 | `safety` off a `Winder` |
| `holdingPull` | a brake and a radius, 7 of 8 | a brake and a winder |
| `holds`, `heldPull`, both retardations | the winder alone, 5 of 8 | a brake and a winder |

Every other keyword in the winder file takes `diameter`, out-of-balance is
`power`'s subject in this library, and a `Winder` already carries its brake. The
trials were reading the codebase; round 1 was fighting it without saying so.

### What changed

The task moved to the design the trials found. The three figures now live in
`power` off a duty, the key is `diameter`, everything but `torque` and
`pressure` takes the winder it is bolted to, and `holdingPull` left the graded
surface entirely because `heldPull` grades the same arithmetic. The `Brake`
constructor and its raw fields stopped being asserted as well: one trial stores
shoe width in millimetres, exactly as this repo stores rope diameter, and was
right to.

Two corners went in to keep the other side of the band, both over rules already
stated: a deep cage winder where the least out-of-balance goes negative and the
load stops helping the brake, and an exact tally on the friction winder that
neither holds nor stops an overwind and presses its shoes too hard.

### Replaying the eight

`/tmp/replay.sh` applies each trial's patch to a copy of the base tree, restores
the shipped suites the way `test.sh` does, drops the held-out files in and
counts. Against round 1: 0 of 8 and every file dead at the import. Against
round 2: **3 solved, one at 56 of 57, one at 55**, the two remaining misses
being audits that file findings past the four the instruction enumerates. Two
more fail only on `holds` arity, which round 2 now states.

That is a measured band before the submission rather than after it, and it is
the single most useful thing to do with a calibration failure.

### Round 2 shape

| figure | value |
| --- | --- |
| solution | +675 / -2 over 10 files |
| held-out tests | +657 over 2 files |
| instruction | 295 words |
| f2p | 57 |
| p2p | 350 |

Battery: base 0, oracle 57/57, alt-shape 57/57, four attacks at 0, 25 of 25
mutants caught. `alt-shape` was rewritten from the new instruction alone, in a
different file, with a positional constructor and no rounding anywhere.

## brake-capacity, round 3

Round 2 got past reference verification and failed quality review on
`behavior_in_tests`, with one exact finding:

> the explicit requirement that both retardations be no lower than zero is
> incomplete: lowering is tested with a negative raw result, while no test makes
> the raw winding retardation negative, so an unclamped winding implementation
> can receive reward 1.

Correct, and worth keeping. The instruction promises "neither below nought" and
only the lowering floor was ever exercised. A build that clamped one and not the
other scored 1.

The fix is one case on the fixture that makes it possible. On the deep cage
winder the rope drives at the end of the wind, so the least out-of-balance is
-31.373 kN; wind the shoes down to 20 kN and the held pull is 23.8, so the raw
winding sum is -7.573 and both figures have to report nought. A matching mutant
that drops the winding clamp went into `mutants.py`, and it is caught: **26 of
26**.

Final bundle: solution +675 over 10 files, held-out +669 over 2 files,
instruction 295 words, 58 f2p, 350 p2p. Oracle 58/58, alt-shape 58/58, four
attacks at 0, replay of the eight Calibration II submissions still 3 solved with
one at 57 of 58 and one at 56.

Submitted 2026-09-06 as **3 of 3**. The submission budget for this draft is
spent: a further round can be built and pushed, but not submitted without the
user.
