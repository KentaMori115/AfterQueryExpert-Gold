# cloudvault — status (session f4b40cad, tree result/cloudvault-f4b4)

## Codebase
CloudVault Storage API: Next.js 15 App Router + Firebase Firestore + Upstash Redis
+ Telegram Bot API. Test runner is **jest + ts-jest** (`__tests__/*.test.ts`),
not vitest. Base suite 95 cases / 9 files, green in 1.4 s.

`npm ci` fails in this tree (ENOTEMPTY during extraction). `npm install` works.
node_modules lives in the session scratchpad and is symlinked in.

Offline-gradeable pool if the platform image ships no node_modules:
file-utils 54, api-key 23 (needs a uuid stand-in), share-utils 6, stats 6,
webhook 2, version-trash 1, workspace-rbac 1 = 93. The sharp and bcrypt suites
cannot run offline. p2p floor 50 clears either way.

## Slate (four sessions author on this snapshot at once)
| session | tree | task | area |
| --- | --- | --- | --- |
| f4b40cad (this) | cloudvault-f4b4 | delivery-retries (proposed) | webhook delivery retry + endpoint suspension |
| 448ce797 (peer 4c) | cloudvault | usage-allowances | metering: periods, allowances, admission |
| mindriftwork-f7 | cloudvault-74ab | ranged-downloads | byte-range serving |
| mindriftwork-55 | cloudvault-b442 | resumable-uploads | upload sessions / parts |

Slate settled 2026-09-05: 55 and 4c both dropped byte-range before building, so
f7 keeps it alone and the four claims are disjoint. Exactly four tasks for four
slots. None of the other three touches lib/webhook*.ts or app/api/webhooks/**.

## This session's claim
task name: **delivery-retries**  category: **feature_request**
Changed-file set reserved:
  lib/webhook-queue.ts        (new, pure, dependency free)
  lib/webhook-retry.ts        (new, pure, dependency free)
  lib/webhook.ts              (edited: dispatch through the planner)
  app/api/webhooks/queue/route.ts        (new)
  app/api/webhooks/endpoints/[id]/route.ts (edited: resume a suspended endpoint)
Held-out: __tests__/webhook-queue.test.ts, __tests__/webhook-retry.test.ts

NOT touched by this session: lib/file-utils.ts, lib/firestore-admin.ts,
lib/range*.ts, lib/chunk*.ts, app/api/file/**, app/api/share/**.

## Step 0 (environment proof) — GREEN 2026-09-05
Draft `delivery-retries` = **aoqomqZCXUa50YqwF8TF**, repo **5CviKRq9xQSJMXtliovF**
(platform name `tg-storage-api`), env **v1**, base commit
`451b9dc6ef18ab374ada270d111fa0731517a6b4` = the snapshot tree.

`env-log 5CviKRq9xQSJMXtliovF 1` shows the generator DOES install a toolchain
(step 7): jest 29.7.0, ts-jest 29.2.5, typescript 5.8.3, @types/jest,
@types/node, @types/bcrypt, uuid 11.1.0, sharp 0.35.3, bcrypt 6.0.0,
firebase-admin 13.4.0 into /opt/task-node_modules, copied to /app/node_modules,
with PATH and NODE_PATH set to it.

Rebuilt locally from those exact steps
(`tasks-f4b4/delivery-retries/environment.v1.local.Dockerfile`) and ran the base
suite with `--network none`: **95 passed / 9 suites / 6.2 s**. So all 95 base
cases are usable p2p and no offline stand-in harness is needed.

Also in the image: python3 3.11.2, setpriv, uid 65534 nobody.
NOT in the image: next, @upstash/redis, clsx, tailwind-merge, and no
jest-ctrf-json-reporter or jest-junit — the verifier ships its own reporter.
Graded code must therefore import nothing outside node builtins + that list.

## delivery-retries — PASSED ALL 8 STAGES 2026-09-05 (round 5), Needs Review
Draft aoqomqZCXUa50YqwF8TF, category feature_request.

Gap: `dispatchWebhookEvent` posts once and logs whatever came back. No retry,
no backoff, no per-endpoint health; the only retry in the tree is the manual
button at `app/api/webhooks/deliveries/[id]/retry`.

Solution +603 / 5 files: `lib/webhook-queue.ts` (new, graded: `sweepQueue`,
`recordAttempt`), `lib/webhook-retry.ts` (new, timing arithmetic),
`lib/webhook.ts` (queue persistence, drain, dispatch respects a cooldown),
`app/api/webhooks/queue/route.ts` (new), `app/api/webhooks/endpoints/[id]/route.ts`.
Held-out +762 / 2 files: `__tests__/delivery-sweep.test.ts`,
`__tests__/delivery-attempts.test.ts`. 61 f2p, 95 p2p, instruction 289 words,
2.09 lines per word.

Difficulty is the collisions, not the surface: abandonment is settled across
the whole queue before anything sends, so a spent delivery neither holds an
endpoint's probe slot nor eats the three-per-sweep budget; a probe failure
cools the endpoint again one level deeper without waiting for another five
failures; backoff and cooldown are separate clocks and the sweep takes
whichever is later; the delivery a sweep gives up on frees the probe slot in
that same sweep.

### Verifier
Real jest, since the image ships it. Config, reporter and integrity guard all
live outside /app because `jest.config.js`, `tsconfig.json` and `package.json`
are committed files a submission can rewrite. `ts-jest` runs transpile-only
(`isolatedModules` + `diagnostics: false`), so a submission's own types cannot
zero the graded file. `/app/node_modules` is deleted and resolution points at
`/opt/task-node_modules`. jest runs as nobody under setpriv; the parent reads a
per-run token from stdin before any worker exists and signs the result stream
with it; a root python3 publisher verifies the signature and publishes every
whitelisted id, failing the ones the stream did not carry. The run block also
restores the nine base suites from HEAD.

### Local matrix (verify_task.sh, all in the reconstructed v1 image)
| case | reward | note |
| --- | --- | --- |
| nop | 0 | f2p 0/61, p2p 95/95 |
| oracle | 1 | 61/61 and 95/95 |
| alt-shape (correct, class based, extra fields) | 1 | shape independence |
| edit-base-test (break lib/stats.ts, rewrite its suite) | 0 | suite restored, 3 p2p fail |
| forge-report (unsigned stream + written reports) | 0 | signature refused, 7 trivial negatives only |
| neuter-expect (expect/Object.is/JSON.stringify replaced) | 0 | guard catches |
| shadow-config (jest.config.js, tsconfig, package.json rewritten) | 1 | none of them is read |


### Pipeline history (5 rounds, submit granted by the user 2026-09-05)
| round | failed stage | what it actually was |
| --- | --- | --- |
| 1 | Calibration II, 0 of 8 | not difficulty: `send`/`abandoned` returned delivery objects in every trial because the instruction never said they hold ids (22 cases), plus `cooldownUntil: null` for "no cooldown" (3 cases). Trials were 36-39 of 61 with p2p 95/95 throughout. |
| 2 | Quality review | `recordAttempt` documented as returning "both" rather than `{ delivery, health }`; failed behavior_in_task_description, instruction_self_containedness and structured_data_schema, all one omission. Also warned that 3 test titles read verbatim as instruction sentences. |
| 3 | Calibration II, 0 of 8 | trials reached 64-65 of 67. Two cases failed in ALL eight: nothing said a probe slot frees when the delivery holding `probeId` stops being pending. |
| 4 | Quality review | behavior_in_tests: the instruction promises neither function changes its arguments, but the immutability case never snapshotted `endpoints`. |
| 5 | — | all eight passed. Calibration I 0 of 5, Calibration II in band, run audit pass on all four criteria. |

Final bundle: 75 f2p / 95 p2p, solution +639 over 5 files, held-out +1026 over 2
files, instruction 295 words, 2.17 lines per word. The only surviving finding is
the non-blocking ciChecks warning that the instruction is over 250 words; every
attempt to close it would have deleted a stated rule, which is what caused
rounds 1 and 3.

### What made it land in band
Rounds 1 and 3 were both spec gaps that LOOKED like difficulty. Closing them
alone would have flipped the task to too_easy, since apart from the ambiguity
the trials were at 65 of 67. Each fix therefore shipped with a stated
interaction the trials had to earn:
- round 2 added the fairness rotation (one delivery per endpoint per round,
  three rounds and six sends, probes counted);
- round 4 added duplicate-event collapse, whose survivor is chosen by
  `queuedAt` while the sweep itself works in `nextAttemptAt` order. Two
  orderings in one rule is what an implementation reusing its own sort gets
  wrong.
