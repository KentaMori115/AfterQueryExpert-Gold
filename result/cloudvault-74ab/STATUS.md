# cloudvault — CloudVault Storage API

Snapshot `snapshot.borrower-v2-g1787258560392223.zip`, unpacked 2026-09-05 into
`repo/`. Seat dragan. Repo id and base commit are unknown until the user makes
the first draft on this codebase.

## Shape

Next.js 15 App Router, TypeScript, Tailwind, jest + ts-jest. A file storage
service that proxies uploads into a user's Telegram chat and serves them back
through `/api/*`. 135 files.

- `app/api/**` — 31 route handlers (upload, file, files, delete, share, shares,
  trash, workspaces, webhooks, apiKeys, dashboard).
- `lib/**` — 16 modules. Only four are free of runtime dependencies:
  `file-utils.ts`, `stats.ts`, `share-utils.ts` (node crypto) and, with a uuid
  stand-in, `api-key.ts`. The rest pull firebase-admin, sharp, bcrypt,
  @upstash/redis or next/server.
- `__tests__/**` — 9 suites, 95 cases.

Base suite locally: `npm ci` 57 s, `npx jest --ci` **9 files / 95 cases, all
pass** in 1.4 s on Node 24.7.

## Step 0 — PASSED, and the image installs dependencies

Repo id **5CviKRq9xQSJMXtliovF** (platform name `tg-storage-api`), base
**451b9dc6ef18ab374ada270d111fa0731517a6b4**, environment v1 published
2026-09-03. Log saved as `env-log.v1.txt`.

The guess was wrong in the good direction. This generator does not hand over a
bare `node:*-slim` the way account-updater's did. Ten steps, and step 7 is a
dependency install:

```
FROM node:24-bookworm-slim
install git
COPY repo/ /app
apt-get install ca-certificates git python3 make g++
npm install jest 29.7.0, ts-jest 29.2.5, typescript 5.8.3, @types/jest,
  @types/node, @types/bcrypt, uuid 11.1.0, sharp 0.35.3, bcrypt 6.0.0,
  firebase-admin 13.4.0   -> /opt/task-node_modules, copied to /app/node_modules
ENV PATH=/opt/task-node_modules/.bin:$PATH
ENV NODE_PATH=/opt/task-node_modules
git config safe.directory /app, core.hooksPath /dev/null
```

Rebuilt locally from those exact steps as `cloudvault-env:v1real`, and inside it
with `--network none`: `jest --ci` runs the shipped suite **95 of 95 green**,
and the harness grades **94 of 95** (see below). python3 is already in the
environment image, so the verifier image's install step is a no-op.

Two consequences worth carrying:

- **The agent has a working test runner.** Difficulty here cannot rest on the
  agent being unable to run anything, only on values it has to derive.
- **`/app/node_modules` belongs to the submission.** A model patch may add files
  anywhere under `/app`, so `uuid` or `firebase-admin` loaded from there is
  whatever the submission last wrote. `test.sh` therefore symlinks the
  root-owned `/opt/task-node_modules` under `$VERIFY_DIR/deps/node_modules` and
  the loader resolves every package name from that anchor. Proven: with a
  hand-written `uuid` planted in `/app/node_modules`, the unanchored run loses a
  case and the anchored run keeps all 23. Where `/opt/task-node_modules` is
  absent the anchor stays empty and resolution falls back, so `test.sh`
  degrades rather than refusing.

The harness grades every shipped suite except `workspace-rbac`, whose only
import is `import { WorkspaceRole } from "../lib/workspace-rbac"`. That is a
type, and a runtime stripping types rather than resolving them across files
keeps the named import and finds no such export. **94 p2p.**

Superseded reading, kept because it was what the pool looked like before the
environment was known:

| suite | cases | offline |
| --- | --- | --- |
| `file-utils` | 54 | yes |
| `api-key` | 23 | yes, with a uuid stand-in |
| `share-utils` | 6 | yes |
| `stats` | 6 | yes |
| `webhook` | 2 | yes, with a firebase-admin stub |
| `version-trash` | 1 | yes |
| `workspace-rbac` | 1 | yes |
| `share-manager` | 1 | no, bcrypt is native |
| `image-processor` | 1 | no, sharp is native |

93 cases reachable, against a p2p floor of 50.

The repo's test globals are small: `describe`, `it`/`test`, `beforeEach`,
`afterAll`, and matchers `toBe`, `toBeNull`, `toBeDefined`, `toBeGreaterThan`,
`toEqual`, `toHaveLength`, `toMatch`, `toThrow`, `toContain`, plus `.not`.

## Slate

Four sessions unpacked this snapshot within five minutes of each other.
Claimed areas as of 2026-09-05 00:20:

| session | tree | area | files |
| --- | --- | --- | --- |
| this one | `cloudvault-74ab` | ranged downloads | `lib/range-plan.ts`, `lib/range/**`, `app/api/file/[fileId]/route.ts` |
| mindriftwork-7e | `cloudvault-f4b4` | webhook delivery retries | `lib/webhook-queue.ts`, `lib/webhook-retry.ts`, `lib/webhook.ts`, `app/api/webhooks/**` |
| mindriftwork-55 | `cloudvault-b442` | resumable uploads | `lib/upload-session.ts`, `lib/upload-parts.ts`, `app/api/upload/sessions/**` |
| mindriftwork-4c | `cloudvault` | usage allowances | `lib/billing-period.ts`, `lib/usage-ledger.ts`, `lib/allowance.ts`, `lib/quota-decision.ts` |

4c withdrew its partial-downloads claim at 00:20 and moved to metering, so
byte-range is uncontested. A repo caps at four active tasks and all four
sessions want one, which is the remaining pressure.

## ranged-downloads (feature_request) — built and locally verified 2026-09-05

Waiting on the user's draft. Everything below is measured, not estimated.

| | |
| --- | --- |
| solution | +496 lines over 7 files (floor 459 / 4) |
| held-out | 647 lines over 2 files (floors 596 / 2) |
| instruction | 293 words (band 100 to 300), 1.66 solution lines per word |
| f2p | 94 (floor 8) |
| p2p | 94 (floor 50) |

Local battery through `verify_task.sh`, the real `tests/test.sh` driven in a
container built from the bare image:

```
base             0   0 / 94 f2p   94 / 94 p2p
oracle           1  94 / 94       94 / 94
alt-shape        1  94 / 94       94 / 94
edit-base-test   0  94 / 94       89 / 94
forge-report     0   0 / 94       94 / 94
harness-forge    0   0 / 94       94 / 94
kill-runner      0   0 / 94       94 / 94
plant-held-out   0   0 / 94       94 / 94
```

The env image `verify_task.sh` builds is now the platform's own ten steps, not
a guess at them, so a green row here means what it means there.

`alt-shape` is the one that matters for calibration: a second implementation
written from the same wording, one class instead of six modules, spans as pairs,
the header read by one regular expression and the framing measured by writing
the lines out, scores full marks. The suite pins behaviour, not the reference's
shape.

Two independent checks stand behind the numbers in the suite, both in
`tasks/ranged-downloads/checks/`.

`cross.py` runs a Python reading of the same rules, which builds the multipart
body as text and measures it rather than repeating the arithmetic, over **5000
randomised manifests and headers: zero mismatches** against the reference and
zero against the alt-shape build. A quarter of those jobs ask for the edges by
name, because a uniform sweep over a file of a few thousand bytes lands on "the
byte after the last" about once in some thousands of draws, and a mutation that
only moves an edge then reads as though it moved nothing.

`mutants.py` runs **40 mutations, and makes each earn its kill twice**: the
bytes have to move, the plan has to differ from the reference somewhere in the
5000, and only then does the suite have to fail it. Result: **40 killed, 0
survived, 0 identity, 0 unmatched**, and **every one of the 73 cases is felled
by at least one mutant**. That last number is the one worth keeping. It started
at 53 of 73, and the 20 cases nothing could fell were not all decorative: most
just had no mutant aimed at them, and writing those mutants (a hardcoded content
type, a suffix off by one, reads stopping after the first chunk, a cap counted
on the header's members, every gap crossed, served short by one) killed 16 of
them. The last one, a duplicated member folded away, was genuinely unreachable,
because stitching absorbs a duplicate whatever folding does, and it was closed
by asserting the reads instead.

The same reading found the earlier `or touch` defect: folding on a touching pair
is unobservable, since a gap of nought is always under the saving, so the
instruction says `where they overlap` and nothing promises what cannot be shown.

A stub returning a fixed 200 shell passed 12 cases before those 12 were
tightened. It now passes none.

### What the task is

`planRangedResponse` in `lib/range-plan.ts`, over
`lib/range/{types,header,coverage,manifest,framing}.ts`. The rules that carry
the difficulty, none of them checkable in a container with no test runner:

- a Range header is read whole or dropped whole, and a dropped one sends the
  file entire rather than the members it did understand;
- members measure against the file, one starting at size or beyond goes, a
  suffix over size starts at nought, nothing surviving is 416;
- survivors fold where they overlap, and then a pair whose gap holds fewer
  bytes than the framing that keeping them apart costs goes out as one, gap
  carried. The saving is not a constant: the range line carries the offsets, so
  the two that vanish from the middle are worth their own digits;
- over four stretches after that, the file goes out entire, which stitching can
  rescue a request from;
- reads never cross a chunk, and chunk sizes are not uniform;
- one stretch is a plain 206, several are a multipart body measured to the byte.

### Files

Nothing under `app/`. See the note below on why.

The gap: the chunked download path in `app/api/file/[fileId]/route.ts` streams
every chunk from first byte to last and ignores `Range` entirely, so no resume
and no seek.

`app/api/file/[fileId]/route.ts` was in the first claim and came out of it. The
route needs next/server, firebase-admin and node-telegram-bot-api, none of which
a verifier without a package tree can load, so a sentence about the route could
never own a graded case, and a stated sentence with no case behind it is a
rejection on its own. mindriftwork-4c raised it; the file is released to
whoever wants it.

## Pushed

Draft **AUXeC7N8eNCZx4JnpyL8**, pushed 2026-09-05, awaiting submit. Every frozen
file is the draft's own: `task.toml` carries the frame untouched with only the
two display fields written, and `tests/grader.py` matches netpen's byte for byte
(md5 `eedefa2c8fc8a878a0ca9af2f2905431`), which is the platform-shared copy.

`gold_bot.py check`: all ten floors ok, no local problems.

One thing to watch on the first run: `gold.tasks.get` still reports
`taskToml.displayTitle` as `<<EDIT-ME>>`. That is the record parsed when the
draft was made, not the file. The pushed `task.toml` carries the real title and
description, and on netpen the parsed record matches the file once the pipeline
has run, so it refreshes on submit.

### The size floors are floors, not caps

Worth writing down, because the working note said the opposite. `check` reads
**testAddedLines >= 596** and **testFiles >= 2**, and both tasks that have
passed on this seat sit above them with a test patch slightly larger than the
solution churn: netpen 1225 over 1191, webdevium 651 over 646. The first build
here came in at 470 lines in one file and was flagged LOW twice. The suite grew
to 647 over two files and the solution to 496 over seven, which puts the ratio
at 1.30, inside the 0.79 to 1.32 that passing tasks have shown.

## 2026-09-05 — round 2 rejection: anti_cheating_measures + report_integrity

Quality review: "the publisher receives the secret token in its command line and
/tests/config.json is readable, so submitted code running during test import can
recover both via /proc, emit every whitelisted verdict plus END to stdout, and
exit before genuine verdicts are emitted."

True, and reproduced. `attacks/sign-the-report.patch` implements nothing, lifts
the token off `/proc/<pid>/cmdline`, reads the ids from `/tests/config.json`,
signs a pass for each and exits at import time. Against the old wiring it scored
reward 1, 94/94 f2p. Against the fixed wiring it scores 0/94 and the run log
reads "no token found".

Fix, in `make_test_sh.py`, `harness/publish.py` and `harness/run.mjs`:

- the token is generated straight into a root-owned file under a 0700 directory,
  never through a shell variable, an argument or an environment;
- both ends of the pipeline open it, then the file is unlinked, so no path
  reaches it whatever uid the child ends up with;
- the child gets it as stdin and closes fd 0 before the first dynamic import;
  the publisher gets it as fd 3 and neither process holds the other's copy;
- `/tests` is shut for the length of the run and opened again after.

Round 1 had failed instruction_reads_naturally; the instruction was rewritten in
plain prose (296 words) and that criterion passed on round 2.
