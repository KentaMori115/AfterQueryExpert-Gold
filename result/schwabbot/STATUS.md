# schwabbot (SchwabOptionBot) — Gold repo record

Snapshot `snapshot.borrower-v2-g1788454187585206.zip`, unpacked to `repo/`.
Django 5.1.5 + channels/daphne options-trading bot for the Schwab API, with a
fixture-backed offline stand-in (`Engine/offline.py`, `SBOT_OFFLINE=1`) so
nothing touches the network. Repo id `62K48OhILrG3idHZAX17`, base
`7bc88a1c75c331045b5714ee4a411e0321efc5a1`, environment
`/SBot_V3.18` v2 (`gold-repo-sbot-v3-18-62k48o:v2`).

## Step 0 — the environment can grade

`env-log 62K48OhILrG3idHZAX17 2` shows seven steps: `FROM python:3.12-slim`,
git, `COPY repo/ /app`, `WORKDIR /app`, `ENV ... SBOT_OFFLINE=1
DJANGO_SETTINGS_MODULE=SchwabOptionBot.settings`, `pip install` of all eleven
pinned requirements, then the git safe.directory step. Rebuilt locally step for
step as `sbot-8f3a-env:v2`:

```
docker run --rm --network none sbot-8f3a-env:v2 python manage.py test
=> Ran 62 tests, OK
```

**There is no pytest in that image and none in requirements.txt.** The
scaffold's `pytest-junitxml` label is a menu, not a fact about this repo: the
verifier has to drive `unittest` itself and write the JUnit by hand.

## Traps in this repo, for whoever builds here next

- **There is no pytest in the image**, and none in requirements.txt. The
  scaffold's `pytest-junitxml` label is a menu. Drive `unittest`.
- **`BotCheckFun` is never a valid hook for anything the run creates.**
  `SetRunTime` schedules it at `BOT*_CHECK_MIN` *before* the run time, so with
  the shipped config it fires at 12:43 against a 12:53 run. Anything that needs
  the run to have happened wants its own repeating job, started by the run.
- **Do not reset private module state in a graded test.** `Engine.offline.
  _PAPER_ORDERS` is the obvious one, and the repo's own `tests/test_offline.py`
  clears it, which is not cover: two sessions here lost a round to
  `behavioral_test_surface` on exactly that. Key each case by its own username
  instead, or read state back through a public return.
- **Cover the caller, not only the new module.** Both tasks reviewed so far
  failed `behavior_in_tests` first time for grading a new package's helpers
  while leaving the engine or endpoint that performs the feature untouched.
  Everything routes into `Engine.offline` under `SBOT_OFFLINE=1`, so the real
  path runs in a graded suite with no network and no mocks.
- **`site-packages` ships its own top-level `tests` package.** With `/app`
  appended last, `import tests.test_x` loads that one.

## Slate (4 slots, four sessions on one repo)

| name | draft | session | files |
| --- | --- | --- | --- |
| `gap-up-straddles` | `Nrt9DCbeEVsj8kAydaUv` | this one | new `Engine/straddle/*`, `Engine/bot/bot02_engine.py`, `Engine/bot/bot02_manage.py`, `Engine/offline.py` |
| `risk-budget` | — | mindriftwork-c6 | new `Engine/risk.py`, `Engine/server_api.py`, `BotList/models.py` + migration, `AdminCustom/*` |
| `midprice-ladder` | `M2uDISQ0PVJj8McSDfWy` | mindriftwork-07a9 | new `Engine/pricing.py`, `Engine/ladder.py`, `Engine/bot/bot01_engine.py`, `Engine/bot_api.py`, `Engine/config.py` |
| `reset-code-approval` | — | fourth session | `Users/*` |

Disjoint by agreement. The bot01/bot02 split was swapped after the first claim:
see the dead-end below.

## gap-up-straddles

Category `feature_request`. Full record in `tasks/gap-up-straddles/`.

**The dead end worth remembering.** The first idea was that
`BotAdminSetting.vix_gap_up` is a dead field and the gap-up structures the
notes describe are missing. Wrong on both counts. `Engine/consumers.py:
set_bot2_server_info` reads the flag, and `bot02_engine` already implements the
whole gap-up branch: `find_otm_options_by_delta`, `get_straddle_payload`,
`get_defined_risk_straddle_payload`, the NET_CREDIT/TRIGGER parent with its
`priceOffset: -50` profit-target child, and matching arms in
`Engine.bot_api.get_new_limit_price`. An agent would have copied it.

**What is actually absent** is the other end of the day. The structures go on
and nothing ever takes them off: the target only fills if the market comes to
it, these are same-day contracts, `BotCheckFun` is a stub that prints, and
`cancel_order` on the parent leaves the child working. So the feature is the
exit: `Engine/straddle` turns a live entry plus current quotes plus minutes
remaining into hold or close, and `Engine/offline` learns that a profit target
is an order of its own.

Levers none of the shipped fixtures can reveal: the exit prices at the touch
while every entry in the repo prices at the middle; a debit rounds down and a
credit rounds up, on a decimal grid rather than `math.floor(p/tick)*tick`,
which walks grid-exact prices down a full tick; closing legs carry the lot size
the engine wrote into the entry, not the 1 every builder emits; an unpriceable
leg drops the whole order to MARKET with no price key; the cushion boundary is
inclusive and a session past the bell never works a limit.

### Round 1, submitted 2026-09-06

ciChecks, aiCheck, similarity and oracleNop all passed. **qualityCheck failed**
on three blocking criteria, which came down to two faults:

1. `behavior_in_tests`: "the central promise that Bot 2 actually remembers
   entries and closes them from its scheduled check is not tested. Full reward
   is possible without the reference patch's Bot02Engine/Bot02Manage
   integration." The graded suite only exercised the pure helpers.
2. `behavioral_test_surface` and `implementation_acceptance_breadth`, one fault
   seen twice: every offline case called `offline._PAPER_ORDERS.clear()` in
   setUp. Resetting a private store is a contract nobody stated, and a correct
   build keeping its paper orders anywhere else would fail on leaked state.

The rest passed, including `anti_cheating_measures`, `report_integrity`,
`separate_verifier_integrity`, `behavior_in_task_description`,
`instruction_reads_naturally` and `f2p_p2p_consistency`.

### Round 2 fixes

- **Isolation without private state.** Every offline case books under a name of
  its own (`'ada-%s' % self._testMethodName`), so nothing has to clear
  anything: `paper_order_summaries` already filters by user. No test touches
  `_PAPER_ORDERS` any more.
- **The engine is graded.** `LiveEntryTests` on the pure `live_entries`
  helper became `EngineMemoryTests` and `EngineCheckExitTests` driving a real
  `Bot02Engine`: `remember_live_entries(signal_info)` fills `live_entries`, and
  `check_exit(now)` is measured through the paper broker, which is safe because
  `send_order`, `cancel_order`, `get_list_quote` and `get_order_status` all
  route to `Engine.offline` under `SBOT_OFFLINE=1`. A late check has to pull
  the target, book a closing order and drop the entry; an early one must do
  none of those.
- **A real gap the review exposed.** The exit was hung off `BotCheckFun`, which
  `SetRunTime` schedules `BOT2_CHECK_MIN` *before* the run: it had always fired
  by the time there was anything to close. Replaced with `StartExitSweep` /
  `ExitSweepFun` / `StopExitSweep`, a repeating job the run itself starts and
  the sweep cancels once nothing is held.
- Instruction rewritten around the engine contract, 298 words.

### Round 2 rejection (qualityCheck, four blocking criteria)

`behavior_in_task_description`, `implementation_acceptance_breadth`,
`instruction_self_containedness` and the advisory `structured_data_schema` all
fired on one thing: the graded suite indexes a live entry as `['payload']`,
`['order_id']` and `['trading_symbol']`, and the instruction described those
three values without ever naming the keys. `behavior_in_tests` fired on the
other: "never verify that a completed Bot 2 execution invokes
`remember_live_entries` or that the exit sweep is scheduled ... a disconnected
helper implementation can receive full reward."

### Round 3 fixes

- **The record has names now.** The instruction spells out `payload`,
  `trading_symbol` and `order_id`, in the sentence that already described what
  each of them carries. Four words.
- **The run is graded, not the helper.** `EngineRunTests` drives the real
  `execute_strategy()` through the gap-up branch offline: `order_gap_sec: 0`,
  the fixture option chains, one user sized `Fixed`. Six cases assert the run
  itself ends up holding what it sent, at the size it sent, under the id the
  broker gave it, and that the entry it left can then be taken off at the bell.
  A day with no gap up holds nothing.
- **The schedule is graded.** `Bot02Manage.Run` was untestable because it reads
  the wall clock and refuses weekends, so `ManagerSweepTests` holds the clock at
  a fixed Wednesday by patching `datetime` in `bot02_manage` and
  `bot02_engine` - a name the *base* file already uses, so no legitimate
  implementation is rejected by the patch. `Run()` then leaves exactly one job
  in `schedule.jobs`, a second `Run()` does not stack another, and running that
  job by hand pulls the target, books the closing order, drops the entry and
  cancels itself. `EarlyManagerSweepTests` runs the same job at 10:30 and gets
  none of that. Neither class touches a private attribute; jobs are diffed
  against what was standing before the test.
- Four new mutations cover the two call sites: the run never telling the engine
  what it left open, the run never leaving a sweep behind, every run stacking
  another, and a sweep that never stops.
- Instruction held at 298 words: the sweep sentence and the three key names
  were paid for by dropping one scene-setting sentence and tightening wording.

### Round 3 rejection (qualityCheck, three blocking criteria)

- `behavior_in_tests`: "the explicit requirement that `check_exit` plan and
  process each live entry is only tested with one live user. An implementation
  that closes only the first entry could satisfy every configured f2p test."
- `behavioral_test_surface` and `implementation_acceptance_breadth`, both on
  the same thing: the manager tests patched
  `Engine.bot.bot02_manage.datetime` and `Engine.bot.bot02_engine.datetime`.
  "Equivalent implementations using `Engine.straddle.clock`, importing the
  `datetime` module, or another legitimate clock seam can fail manager tests
  despite identical observable behavior under a controlled time."

The second one is the lesson: a patch is only safe if it holds a seam the base
file already uses *and* nothing asserted depends on it. Round 3 satisfied the
first half and not the second.

### Round 4 fixes

- **No mock anywhere in the suite.** `Run` now arms the sweep as its first
  statement, before the weekday guard and the readiness guard can return, so
  the wiring is observable without holding a clock at all: a run that opens
  nothing pays for one pass, and a sweep with an empty book cancels itself on
  that pass. The manager cases then turn on what the engine is holding, never
  on the hour - a counting `Bot02Engine` subclass for "the job reached the
  engine", an entry that cannot be unwound for "the job keeps coming back",
  an empty engine for "the job stops". `unittest.mock` and `pytz` are gone
  from the test file.
- **check_exit is graded on a crowd.** `CrowdedCheckExitTests` puts three
  users out of one run, each at a different size and under a different
  trading group. Eight cases: every user gets a plan, every target is pulled
  and not just the first, every user gets a closing order of their own, an
  early check leaves all three alone, and one user whose structure cannot be
  unwound neither strands the others nor is dropped himself.
- Two more mutations: the sweep reaching only the first entry
  (`[:1]`), and one unclosable entry ending the sweep for everyone (`break`
  for `continue`). Both are exactly the build the reviewer described.

### Round 4 rejection (difficultyProbe, 0 of 8)

qualityCheck and easinessProbe both passed. The eight difficulty trials all
completed, none crashed, and every one of them landed at 100-107 of 110 f2p
with 62/62 p2p. That is the signature of unstated contracts, not of a task
that is too big. Tallying the failing ids across the eight reports gave three
clusters:

| failing id | trials | cause |
| --- | --- | --- |
| `ManagerSweepTests.test_a_sweep_with_nothing_to_do_stops_coming_back` | 8 of 8 | **my test was wrong.** A job in `schedule` self-cancels either by calling `cancel_job` or by returning `CancelJob`; `Job.run()` on its own honours neither, only the scheduler does. Every legitimate build that used the library's own idiom failed. |
| the other five `ManagerSweepTests` | 7 of 8 | the instruction never said *where* in `Run` the job is armed. Seven trials armed it after the readiness guard, which is the natural place; the tests call `Run` on an engine that is not ready. |
| `test_a_credit_rounds_up_to_the_tick`, `test_closing_a_defined_risk_structure_can_pay` | 6 of 8 | "negative net a `NET_CREDIT` rounded up" reads as rounding the *net*: -3.52 rounds up to -3.50, so the order carried 3.50 where the reference carries 3.55. Six trials read the words exactly as written. |
| `test_one_user_who_cannot_be_unwound_does_not_strand_the_rest` | 3 of 8 | left alone: 3 of 8 is difficulty, not ambiguity. |

### Round 5 fixes

- `sweep_once()` runs the job the way `Scheduler._run_job` does, cancelling it
  when the function hands back `CancelJob`. Replaying trial `3tigTrD`'s own
  patch against the fixed suite takes it from 107 to 108 of 110.
- The instruction says the job is armed "first thing, before its weekend and
  readiness checks can return".
- The credit is now "priced at what it collects, rounded up", which is the
  figure the order actually carries.
- Paid for by dropping "Session `NORMAL`, duration `DAY`, `SINGLE`" and "A
  price already on the tick stays": the first three strings are all over the
  base checkout, and the second is entailed by "rounded down to that symbol's
  tick". The audit confirms neither leaves a graded string unmentioned, and
  both sets of cases stay.

### Measured

| row | r1 | r2 | r3 | r4 | round 5 |
| --- | --- | --- | --- | --- | --- |
| reference | 79/79 | 87/87 | 102/102 | 110/110 | reward 1, 110/110 f2p, 62/62 p2p |
| base | 0/79 | 0/87 | 0/102 | 0/110 | reward 0, 0/110 f2p, 62/62 p2p |
| mutants | 18/18 | 24/24 | 28/28 | 30/30 | 30/30 caught |
| attacks | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 defended, baseline 0 |
| solution | +645 | +695 | +695 | +699 | +699 / -16 over 8 files (floor 459 / 4) |
| held out | +636 | +683 | +877 | +949 | +961 over 2 files (floor 596 / 2) |
| instruction | 297 | 298 | 298 | 298 | 296 words, 2.36 lines per word |

### Round 5: PASSED

All eight stages green on 2026-09-06, draft `Nrt9DCbeEVsj8kAydaUv`, status
**Needs Review**. Calibration I 0 of 5 solved; Calibration II passed;
failureValidation passed; qualityCheck clean with no criterion out of pass.
The only finding left standing anywhere was the advisory 296-words-against-250,
which never blocked at any round.

Do not push to this draft again.

### Local machinery

`tasks/gap-up-straddles/local/`: `child.py` and `publish.py` (the two verifier
interpreters), `make_test_sh.py` (fills the frozen frame and the digest pins),
`make_config.py`, `verify_task.sh`, `mutants.py`, `attack_matrix.py`,
`audit.py`. Docker tags namespaced `sbot-8f3a-*` because four sessions share
one daemon.
