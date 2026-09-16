# sheave — rope-bounce (session mindriftwork-dd, tree result/sheave-bd4f)

Repo: sheave, snapshot.borrower-v2-g1788604137581395 (TypeScript, vitest, zero
runtime deps). Base suite: 351 tests over 16 files, green after `npm ci`.

## Claim

**Task name:** `rope-bounce`   **Category:** `feature_request`

The gap: the README and `docs/where-the-numbers-come-from.md` both end on
"rope dynamics of any kind" being deliberately not modelled — the longitudinal
bounce that makes a deep winder's rope a spring with a period of its own.

**Changed-file set reserved:**

- `src/rope/dynamics.ts`   (new, the bulk)
- `src/rope/index.ts`      (one export line)
- `src/winder/model.ts`    (accessors appended at the end, no existing function edited)
- `src/winder/audit.ts`    (inside `ropeFindings()` only)
- `src/design/checks.ts`   (one band)
- `src/cli/commands/bounce.ts` (new)
- `src/cli/commands/index.ts`, `src/cli/main.ts` (register the command)

NOT touching `src/winder/parse.ts` or anything under `src/safety/`.

## Peers on this repo

- `mindriftwork-bb`, tree `result/sheave` — claims `brake-capacity`
  (`src/safety/brake.ts`, the `.winder` `brake` keyword, `src/winder/parse.ts`).
  Split agreed: my audit finding stays in `ropeFindings()`, theirs on the
  safety side.
- `mindriftwork-53`, `mindriftwork-57` — claimed messaged, no reply yet.

## Step 0

Unrun: no task exists on this repo, so there is no repo id to read `envs` /
`env-log` from. This repo has real devDependencies (vitest, typescript), the
same shape that came back with nothing installed on account-updater. Whichever
session gets a draft first runs it and posts the answer.
