# AfterQueryExpert-Gold

Working tree for the **KentaMori** seat (`kenta.mori32@gmail.com`, uid
`nZUFEoNQTnY70dqJmJ9YCesQrCs1`) on the task-authoring platform described in
[docs/instruction.md](docs/instruction.md).

Everything here is *authoring* work, not application code. Each entry under
`result/` is one attempt at turning a private codebase snapshot into a graded
engineering task: an instruction, a reference solution patch, a held-out test
suite, and the verifier wiring that grades an attempt pass/fail with no human
in the loop.

The build logs in this tree run **2026-08-28 → 2026-09-08**. Statuses below are
what the `STATUS.md` files last recorded; nothing here re-queries the platform.

---

## Layout

```
LAYOUT.md            where things go + this seat's auth and thresholds
original_test.sh     the frozen verifier entrypoint frame (edit only between the RUN TESTS markers)
tmp_solution.patch   stray artefact: the sagemark rest-recovery solution (8 files), left at the root
docs/                the platform's rules and the accumulated craft notes
snapshots/           two incoming snapshot zips kept as they arrived
result/<tree>/       one session's work on one codebase
    repo/            the unpacked snapshot at the base commit
    data.txt         repository url / platform metadata
    STATUS.md        the build log — the real record of what happened
    tasks/<name>/    the task bundle (instruction.md, solution/, tests/, task.toml, environment/)
result/<repo>-SLATE.md   shared claim sheet when several sessions share one codebase
```

Auth for this seat is **not** the default file — every command runs as
`GOLD_AUTH=~/.config/gold/auth-dragan.json`. `auth.json` (alexandra) and
`auth-alexsey.json` are other seats; refresh tokens rotate on every mint, so the
three must never be crossed.

Seat thresholds from `gold.me`: solution ≥ 459 lines / 4 files, held-out ≥ 596
lines / 2 files, instruction 100–300 words, f2p ≥ 8 (aim 20), p2p ≥ 50,
0.9–7.5 solution lines per instruction word.

---

## Docs

| file | what it is |
| --- | --- |
| [docs/instruction.md](docs/instruction.md) | the platform's own rules: eligibility, environments, the five editable files, scope floors, verifier contract, the eight-stage pipeline |
| [docs/knowhow.md](docs/knowhow.md) | 2,535 lines, 55 numbered lessons from six passes on the *dynamo* seat — how to make a task genuinely hard, how to prove verifier coverage by mutation, how the gates actually order themselves and what each costs |
| [docs/git_commit.md](docs/git_commit.md) | how to build a repository's commit history so a task's base commit can sit in the middle of it |
| [docs/chat_hisory.md](docs/chat_hisory.md) | raw session transcript kept for reference |

---

## What has been built

**20 distinct codebases, 39 session trees, 57 task bundles**, ~24 GB on disk
(almost all of it unpacked repos and `node_modules`).

### Passed the full eight-stage pipeline (terminal `Needs Review`)

| codebase | task | tree | when |
| --- | --- | --- | --- |
| cueforge | `source-locations` | `result/cueforge` | 2026-08-30 |
| portfire | `chained-runs` | `result/portfire` | 2026-09-03 |
| portfire | `panel-record` | `result/portfire` | 2026-09-03 |
| slateql | `index-scans` | `result/slateql` | 2026-09-03 (round 3) |
| slateql | `interval-arithmetic` | `result/slateql` | 2026-09-03 (round 2) |
| slateql | `window-functions` | `result/slateql` | 2026-09-03 (round 11) |
| portfire | `stock-substitution` | `result/portfire` | 2026-09-04 (round 9) |
| signalbox | `automatic-signals` | `result/signalbox` | 2026-09-04 |
| signalbox | `speed-restrictions` | `result/signalbox` | 2026-09-04 (round 5) |
| netpen | `harvest-schedule` | `result/netpen` | 2026-09-04 (round 8) |
| veldt | `intersect-except` | `result/veldt` | 2026-09-04 |
| fwctl | `staged-activation` | `result/fwctl` | 2026-09-04 (round 3) |
| cloudvault | `usage-allowances` | `result/cloudvault` | 2026-09-05 |
| cloudvault | `resumable-uploads` | `result/cloudvault-b442` | 2026-09-05 (round 8) |
| cloudvault | `delivery-retries` | `result/cloudvault-f4b4` | 2026-09-05 (round 5) |
| tanager | `join-variants` | `result/tanager-7c3a` | 2026-09-05 (round 4) |
| tanager | `row-mutation` | `result/tanager-6223` | 2026-09-05 |
| sheave | `rope-bounce` | `result/sheave-bd4f` | 2026-09-06 (round 4) |
| skald | `chunk-audit` | `result/skald-b67a` | 2026-09-06 (round 8) |
| schwabbot | `gap-up-straddles` | `result/schwabbot` | 2026-09-06 |
| schwabbot | `midprice-ladder` | `result/schwabbot-07a9` | 2026-09-06 |
| schwabbot | `risk-budget` | `result/schwabbot-9c1f` | 2026-09-06 (round 3) |
| schwabbot | `reset-code-approval` | `result/schwabbot-bca5` | 2026-09-06 (round 6) |
| layover | `arrive-by-search` | `result/layover-cd08` | 2026-09-06, **first submission** |

Every one of these drafts is marked *do not push again* in its `STATUS.md`.

### Built and verified locally, not through the pipeline

| codebase | task | tree | where it stopped |
| --- | --- | --- | --- |
| configlayer | `config-query`, `config-export`, `typed-config-view`, `yaml-config-files` | `result/configlayer` | all four failed `ciChecks` on the same mechanical cause (an overwritten `task.toml` frame); repaired and re-pushed, awaiting submit |
| arenaflow | `match-void-rescore` | `result/arenaflow-3736` | built + verified 2026-09-07, platform API 429 |
| arenaflow | `reward-recall` | `result/arena-1787511` | built + verified 2026-09-08 (reward 1, f2p 44, p2p 132, 34 mutants / 0 survivors), platform API 429 |
| biomeweaver | `habitat-crowding` | `result/biomeweaver-7e1d` | bundle built, platform side all still to do |
| biomeweaver | `prey-competition` | `result/biomeweaver-prey` | built + verified, draft exists, blocked on the 429 |
| biomeweaver | `event-effects` | `result/ecolab-a6e44a5a` | built, blocked on the 429 |
| sagemark | `bundle-restore` | `result/sagemark-c3b3` | built + verified 2026-09-06 |
| sagemark | `journey-legs` | `result/sagemark-d8c3` | bundle complete, push steps written out |
| sagemark | `rest-recovery` | `result/sagemark-cdde` | proposed, awaiting a draft |
| sagemark | `adventuring-day-plan` | `result/sagemark-48bf` | round 1 failed Calibration II 8/8; round 2 rebuilt, user to push and submit |
| sheave | `brake-capacity` | `result/sheave` | submitted 2026-09-06 as 3 of 3 — budget spent |
| sheave | `decking-time` | `result/sheave-1f04` | round 3, contract realigned |
| sheave | `ventilation-duty` | `result/sheave-vent` | built, waiting on a draft (no repo id without one) |
| layover | `fare-capping` | `result/layover-4294` | round 5 bundle after a round-4 quality-review fix |
| touchline | `suspension-serving` | `result/touchline` | submission 1 failed Calibration I (too easy, 3/5); submission 2 in flight |
| webdevium | `cycle-settlement` | `result/webdevium` | round 4 (instruction-only change) after Calibration II `out_of_band_hard` 0/8 |
| webdevium | `job-fences` | `result/webdevium` | built + verified, waiting on a draft |
| maingott | `narration-takes` | `result/maingott` | rounds 5 and 6 both hit platform errors at Calibration II; diagnosis says the task is genuinely too easy there (reward 1 in all 8 trials vs a 1–6 band) |
| signalbox | `counted-sections` | `result/signalbox` | round 7, `failure_validation` / reward hacking 2 of 8 |
| cloudvault | `ranged-downloads` | `result/cloudvault-74ab` | round 2 rejected on `anti_cheating_measures` + `report_integrity`; the token/`/proc` leak is fixed in the harness |
| tanager | `set-operations` | `result/tanager` | round 2 submitted 2026-09-05 (2 of 3) |
| tanager | `nested-queries` | `result/tanager-1f45` | blocked at step 0 — an assigned repo with no task has no reachable repo id, so the environment can't be proved until the user makes a draft |
| cueforge | `performer-continuity`, `resource-holds` | `result/cueforge` | pushed to drafts, awaiting submit |

### The codebases themselves

| codebase | language | what it is |
| --- | --- | --- |
| arenaflow | TypeScript | deterministic competitive-gaming engine — tournaments, matchmaking, scoring, rankings, rewards, anti-cheat, event journal with replay |
| biomeweaver | TypeScript (npm workspaces) | ecosystem simulation — population, predation, resources, calendar events, tick runtime |
| cloudvault | TypeScript / Next.js | storage API — uploads, ranged downloads, webhooks, usage billing |
| configlayer | Python | deterministic layered-configuration engine (**no `repo/` unpacked in this tree**) |
| cueforge | Python | "Paper Tech" — compiler and rehearsal simulator for live-performance cue sheets |
| fwctl | Rust | firmware update control — first Rust repo on this seat (14th codebase) |
| layover | Python, stdlib only | transit journey planner, 1808 base tests |
| maingott | Python | MainGott Reel Generator — AI-assisted 9:16 advertising reel pipeline, 18k lines, 1108 tests |
| netpen | Vue 3 + TypeScript | marine salmon grow-out operations |
| portfire | TypeScript | firing scripts, cue timing and separation distances for computer-fired pyrotechnics; 2117 base tests |
| sagemark | Vue 3 + Pinia + TypeScript | local-first tabletop RPG campaign manager, 218 spec files |
| schwabbot | Python / Django 5.1.5 | Schwab options trading bot |
| sheave | TypeScript | colliery winding arithmetic — ropes, brakes, decking, ventilation |
| signalbox | Python | railway signalling and interlocking, 2065 base tests |
| skald | Rust | port of a C scripting engine — tagged values, tri-color GC, chunk loader, stack VM |
| slateql | Python | embeddable analytical SQL engine — lexer → parser → binder → logical plan → optimizer |
| tanager | Rust, zero deps | embeddable in-memory database, ~8.7k lines (17th codebase) |
| touchline | TypeScript / Express | grassroots football league administration API, 13.8k lines, twelve six-layer modules |
| veldt | Python, zero deps | analytical query engine, 938 base tests |
| webdevium | Next.js 15 + TypeScript | dashboard with billing/invoicing and job-queue surfaces |

---

## The loop each tree runs

Roughly the same sequence shows up in every `STATUS.md`:

1. **Unpack** the snapshot into `repo/`, get the base suite green locally, and
   record exactly how (`env-log.*.txt`, `envbuild/Dockerfile`, local image tags
   namespaced per session because several sessions share one Docker daemon).
2. **Claim** a task name *and* a changed-file set on the shared `*-SLATE.md`
   before building. Originality compares changed-file sets, so two sessions on
   one codebase must stay disjoint — `result/arena-1787511` documents exactly
   what happens when they don't.
3. **Find the gap**: a field that is parsed and read by nothing, an exported
   function with no caller, a docstring that says a thing is not implemented.
4. **Build** the reference solution and the held-out suite, then size them
   against the floors (`gold_bot.py check`).
5. **Prove the verifier** before pushing:
   - `verify_task.sh` — oracle must score 1, the unchanged repo 0;
   - `mutants.py` — one mutant per sentence of the instruction, all must be caught;
   - an **attack matrix** — patches that forge JUnit reports, shadow the test
     config, kill the runner, neuter expectations, or lift the signing token off
     `/proc`. Every attack row must score 0.
6. **Push**, pull the stored files back and compare byte for byte, then submit
   and watch the eight stages.

`fwctl`'s bundle became the template: `tanager-6223` and `tanager-7c3a` both
record porting their harness from `result/fwctl/tasks/staged-activation`.

---

## Lessons the logs keep repeating

- **Difficulty from something the instruction failed to say is not difficulty,
  it is a defect** — and the run audit finds it. `netpen` states it outright;
  `cloudvault-f4b4` lost two Calibration II rounds to exactly that.
- A probe that fails in **every** trial is a spec gap. The cure is to state the
  contract, never to delete the assertion (`sheave-bd4f`, round 3).
- The instruction is where most rounds are lost. `aiCheck` rejects spec-list
  rhythm, backtick-heavy consumer enumerations and test titles that echo
  instruction sentences; several rounds changed `instruction.md` only and left
  solution, tests and config byte-identical.
- The "aim under 250 words" `ciChecks` warning is advisory and has never blocked
  a stage — buying words back has cost more than it saved (`tanager-7c3a`,
  `schwabbot-bca5`, `touchline`).
- Calibration II bands at 1–6 of 8 solved. Too easy fails as hard as too hard.
- The verifier runs in the container the agent just had, so submitted code can
  read anything the harness leaves reachable. Two rejections here
  (`cloudvault-74ab`, `maingott`) were about exactly that.
- Don't redesign off an in-flight probe artefact — `tanager-6223` reverted a
  part-built feature after misreading an aggregate block as a per-trial tally.

---

## Housekeeping notes

- `result/arena-1787511/tasks/match-void-rescore/` is a finished bundle that
  **must not be pushed** — it duplicates `result/arenaflow-3736`.
- `result/sheave-vent/tasks/ventilation-duty-draft/`,
  `result/layover-4294/tasks/fare-capping-frame/` and
  `result/veldt/tasks/intersect-except-frame/` are frame scaffolds, not
  deliverables.
- `result/schwabbot-9c1f/tasks/tasks/risk-budget` is a nested duplicate path.
- `tmp_solution.patch` at the root belongs to sagemark `rest-recovery`.
- `configlayer` has no `repo/` checkout in this tree.
- The whole tree is a single git commit (`de08cdb submit result`).
