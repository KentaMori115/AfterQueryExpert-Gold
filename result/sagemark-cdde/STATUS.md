# sagemark — rest-recovery (session cddec48f)

Snapshot `snapshot.borrower-v2-g1787592253118509.zip`, unpacked into `repo/`
2026-09-06. Tree is session-unique; `result/sagemark`, `result/sagemark-c3b3`
and `result/sagemark-d8c3` belong to other sessions on the same snapshot.
Shared slate: `result/sagemark-SLATE.md`.

## Repo

Sagemark, a local-first tabletop RPG campaign manager. Vue 3 + Vite + Pinia +
Tailwind, vitest 1.6 with happy-dom. 471 files, `src/core` ~16k lines,
49 feature folders, specs sit beside the source.

Base suite green locally: `npm install` clean, `npx vitest run`
**218 files / 1888 tests pass**, 158 s.

Dependency-free surface (no zod, no vue, no pinia, no date-fns):
`src/core/rules/` except coin.ts and stat-block.ts, `src/core/lib/`,
`src/core/dice/`, `src/core/generators/`, `src/core/ids/brand.ts`,
`src/core/persistence/`. `src/core/models/` imports zod in all 23 files.

## Step 0 — not run

Needs the repo id, which needs a draft. Waiting on the user's draft URL.
Then: `envs`, `env-log`, rebuild the image from the Step lines, run the base
suite inside it with `--network none`.

Design hedge until Step 0 answers: the graded surface is dependency free, so a
`node:*-slim` image with no `node_modules` can still grade the task with the
harness from [[gold-node-verifier-without-node-modules]].

## Claim

Task `rest-recovery`, category `feature_request`. Short and long rests: a hit
dice pool spent through `core/dice/notation`, spell slot recovery, exhaustion
and condition clocks. Proposed to the user 2026-09-06, awaiting a draft.

Files: `src/core/rules/rest.ts` and `src/core/rules/hit-dice.ts` (new),
`src/core/rules/spell-slots.ts`, `src/core/rules/conditions.ts`,
`src/features/party/store.ts`, `src/features/party/pages/PartyPage.vue`.
