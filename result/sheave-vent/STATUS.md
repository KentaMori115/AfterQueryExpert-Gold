# sheave — ventilation-duty

Repo: sheave 0.5.0, TypeScript, vitest 2.1.8, zero runtime deps.
Snapshot: snapshots/snapshot.borrower-v2-g1788604137581395.zip
Tree: result/sheave-vent/repo (own copy; result/sheave and result/sheave-bd4f belong to peers)
Seat: dragan (GOLD_AUTH=~/.config/gold/auth-dragan.json)

## Base state
`npm run check` green on the snapshot: 16 files, 351 tests, types clean, build clean.

## Claim
Task name `ventilation-duty`, category feature_request. Third of four slots.
Peer mindriftwork-dd holds rope dynamics (`rope-bounce`).

## Log
- 2026-09-06 06:13 snapshot unpacked, base suite green.
- 2026-09-06 06:15 gap claimed on result/sheave-SLATE.md, proposal sent to user.

## Built 2026-09-06, waiting on a draft

Reference solution, held-out tests and instruction are finished and verified in
`repo/`; `base/` is the pristine snapshot for diffing.

| figure | got | floor / band |
| --- | --- | --- |
| solution added, non-test | 716 lines over 8 files | 459 / 4 |
| held-out | 690 lines over 2 files | 596 / 2 |
| held-out band | 690 in [670.5, 721), under 716 added | [0.93 x churn, churn) |
| instruction | 293 words | 100 to 300 |
| lines a word | 2.44 | 0.9 to 7.5 |
| f2p | 92 | 8, aim 20 |
| p2p | 351 | 50 |

- `npm run check` green: 443 tests, types clean, build clean.
- 17 mutations of the reference (cube to square, lining perimeter to free-area
  perimeter, parallel by harmonic sum, air power left in watts, natural pressure
  dropped, duty summed rather than taken as the largest, regulator without its
  own road, depth rounded up and uncapped, riding limit off the whole section)
  all caught by the held-out suite.
- Held-out files are `test/downcast.test.ts` and `test/upcast.test.ts`, named
  off the domain rather than off the feature.
- junit ids come out as `classname="test/<file>.test.ts"`, `name="<describe> > <it>"`.

### Still gated on the draft
Step 0 (does the platform image install node_modules for a vitest repo) needs the
repo id, and the repo id needs a draft. `sheave` has no task on this seat yet, so
`gold.repos.list` gives nothing to look up. If the image ships no `node_modules`,
the verifier gets the transform-plus-resolve-hook stand-in used on the earlier
Node repos.

### Collisions
Command names are pinned by `test/cli.test.ts` to more than three characters, so
the command is `ventilation` and the namespace is `air`.
