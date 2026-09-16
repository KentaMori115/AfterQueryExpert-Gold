# schwabbot (Django Schwab option bot) — session mindriftwork-c6

Snapshot: snapshot.borrower-v2-g1788454187585206.zip (unpacked at repo/)

## Claim (session mindriftwork-c6, 2026-09-06)

- task name (proposed): `risk-budget`
- category: feature_request
- changed-file set claimed: `Engine/risk.py` (new), `Engine/server_api.py`,
  `BotList/models.py` + new `BotList/migrations/0013_*`, `AdminCustom/views.py`,
  `AdminCustom/urls.py`, `AdminCustom/templates/pages/risk_budget.html`
- idea: per-user daily debit budget + lot caps enforced across the order
  lifecycle (send / modify price / modify to market / cancel releases budget).

Other sessions: please pick a different file set and idea.

## Step 0 (proven here, 2026-09-06)

- repo id `62K48OhILrG3idHZAX17`, environment `/SBot_V3.18`, head `7bc88a1c75c3`,
  v1 build_failed, **v2 published** (`gold_bot.py env-log 62K48OhILrG3idHZAX17 2`,
  saved as `env-log.v2.txt`).
- v2 = `python:3.12-slim` + git + `COPY repo/ /app` + ENV(SBOT_OFFLINE=1,
  DJANGO_SETTINGS_MODULE) + `pip install` of all eleven requirements lines +
  git safe.directory. **No pytest anywhere**, so the verifier drives unittest
  and writes the JUnit XML itself.
- rebuilt those steps locally (`environment.v2.Dockerfile`, image
  `schwab-env-9c1f:v2`) and ran the base suite with `--network none`:
  **62 tests, OK**. p2p pool = 62.
- base ids: tests.test_offline 21, tests.test_schwab_api 8, tests.test_server_api 14,
  tests.test_user_allow 9, Users.tests 10 (`base_ids.txt`).

## Slate on this repo (4 of 4 taken)

| task | session | draft |
| --- | --- | --- |
| risk-budget | mindriftwork-c6 (this one) | waiting on the user |
| midprice-ladder | 07a9 | M2uDISQ0PVJj8McSDfWy |
| gap-up-straddles | schwabbot | Nrt9DCbeEVsj8kAydaUv |
| reset-code-approval | bca5 | 3sgULaBMtqSRreFKpJfN |

## risk-budget (draft ZEatQ6rr003N3pJL9JIS)

Category feature_request. Claimed 2026-09-06, built the same day.

### The gap

`Engine/server_api.send_order` sizes a combo order from the trader's own
`BotSetting` (Fixed lots, or a percentage of account equity) and sends it at
any price. `lot_size = max(lot_size, 1)` guarantees at least one lot goes out.
Admins can allow a user, pause a user and set the order gap, but nothing caps
what one account spends in a day.

### The feature

`BotRiskLimit` (cap type Fixed or ByAccountBalance, daily debit cap, cap
percentage, max lots per order, max lots per day, enabled) metered over one
US/Eastern trading day, enforced in the send path, with an admin page, a save
endpoint, a release endpoint, and a refusal to start a bot with nothing left.

Files: new `Engine/risk.py`, new `BotList/migrations/0013_*`, new
`AdminCustom/templates/pages/risk_budget.html`, plus `Engine/server_api.py`,
`BotList/models.py`, `BotList/admin.py`, `BotList/views.py`,
`AdminCustom/views.py`, `AdminCustom/urls.py`,
`AdminCustom/templates/admin_base.html`, `Static/js/admin_3.13.js`.

### Numbers

| floor | value |
| --- | --- |
| solution added lines | 595 (>=459), 11 files (>=4) |
| held-out added lines | 645 (>=596), 2 files (>=2) |
| instruction words | 284 (100 to 300) |
| f2p / p2p | 49 (>=8, aim 20) / 62 (>=50) |
| lines per instruction word | 2.10 (0.9 to 7.5) |

### Verifier

No pytest anywhere in env v2, so `tests/test.sh` drives Django's own runner and
writes the JUnit itself. `verifier/child.py` runs one selection and streams a
verdict per case on an inherited descriptor; `verifier/publish.py` never
imports /app, mints the token, hands it over on stdin, runs the child as
nobody under setpriv, and writes the XML only after the child exits, failing
every declared id the run never reported.

Traps this repo sets:

- the image's site-packages ships its own top level `tests` package, so with
  /app appended last a plain `import tests.test_x` loads that one. The child
  loads graded modules from their exact paths with importlib instead.
- a framework snapshot must read attributes with `type(...)`, never
  `isinstance`: django's lazy settings proxy builds the settings on
  `__class__`, which blows up before /app is importable.
- `unittest.signals` holds the ctrl-c handler the runner installs while a suite
  runs. It is excluded from the guard; everything else in `unittest.*` and the
  `django.test` classes is snapshotted before /app is importable and rechecked
  after the project loads, at every verdict, and at the end.
- each selection runs in its own child, so an import that dies at the base
  commit (the held-out modules do) cannot touch the other report.

### Local results

- `verify_task.sh`: solution reward 1 (f2p 49/49, p2p 62/62), base reward 0
  (f2p 0/49, p2p 62/62, every id present).
- `mutants.py`: 18 of 18 mutations caught.
- `attack_matrix.sh`: assert-neuter, forge-report, swap-graded, wipe-p2p,
  sitecustomize, shadow-django, all reward 0.
- `audit_contract.py`: every name and literal the graded suite touches is in
  the base checkout or named by the instruction. What it still prints is
  stdlib (`tzinfo`, `utc`), test data dates, and the deliberately invalid
  inputs (`'Whatever'`, `'plenty'`, `'single_order'`).

### Round 1 (submitted 2026-09-06 01:35): Validation Failed at quality review

ciChecks, aiCheck, similarity and reference verification all passed. Quality
review failed on two criteria.

**behavior_in_tests.** Three promises could be skipped and still score:

1. the `UserMessage` only had to be non-empty, not say what ran out. The
   instruction now asks for `risk budget` in the text and a case reads for it.
2. only two of the four numbers the save endpoint takes had a below-zero case.
   All four do now, and two carry a word where a number belongs.
3. starting a bot was only refused for a day that began with a zero cap. Two
   cases now spend the day first, one on money and one on lots, and
   `bot_onoff` reads both capacities: `risk.lots_left` is new, and the refusal
   fires when either is gone.

**behavioral_test_surface.** The cases imported `Engine.offline` and cleared
and read its private `_PAPER_ORDERS` registry, which no request names, so a
correct build that stored paper orders another way would have failed. Every
use is gone: "nothing was placed" is now read from what `send_order` returns
and from the budget still being there afterwards.

Two ciChecks warnings went with it and are also cleared: the instruction is
252 words (was 284, advisory is under 250 -- close enough that the finding is
gone), and no test title reads as a sentence of the instruction any more.

After the fix: solution +610 over 11 files, held-out 676 lines over 2 files,
instruction 252 words, f2p 54, p2p 62, 2.42 lines per word.

### Round 2 (01:54): Validation Failed, behavior_in_tests again

Reference verification passed again. Two gaps named:

1. no case moved time across trading days, so a ledger with no date filter
   would still have scored 1. The instruction now says `trading_day()` dates
   every hold and that `committed_debit(user_id, day=None)` and
   `committed_lots(user_id, day=None)` answer what one day holds. Three cases:
   one reads another day's ledger, two live through a day and show yesterday's
   money and yesterday's lots do not come off today.
2. the change and release endpoints were never tried by a non-superuser. Three
   cases now: a trader cannot save a budget, cannot move their own cap, and
   cannot release their own day, the last proving the holds survive it.

Both holes are mutation-confirmed: dropping the `trade_date` filter from either
ledger, or the superuser decorator from either endpoint, now fails cases.

### Round 3 (02:06): quality review PASSED

ciChecks, aiCheck, similarity, reference verification and quality review all
green. Calibration I ran 0 of 5 solved.

### Anti-cheating: two holes a peer found, tested here

Both reproduce against a deliberately weakened copy of this runner, and both
are defended by the shipped one. Payload first, always: a payload that fails
against the weak copy proves nothing.

| row | weak runner | shipped runner |
| --- | --- | --- |
| fake graded modules (startup plants same-named modules carrying the declared ids) | 60 of 60 passing on a stub, reward 1, when graded modules resolve by name | 9 of 60, the stub baseline: the fake is ignored |
| neuter `django.test.SimpleTestCase.assertEqual` | 55 of 60 passing when the guard watches only `unittest` | 0 of 60: the snapshot covers `django.test.testcases` |

The neuter payload scored 0 against the weak runner until it stopped rebinding
`failureException`, which `dir(cls)` hands you and which `unittest` calls
`issubclass` on: rebinding it kills the run before any verdict, which reads as
a defence and is not one. Rebind names starting with `assert`, plus `fail`.

Added anyway, since review's wording elsewhere was about origins and
identities: the loader exits if a graded dotted name is in `sys.modules` before
it loads it, and every case that runs must have `__code__.co_filename` equal to
one of the pinned graded paths.

### PASSED all 8 stages, 2026-09-06 (round 3, status Needs Review)

| stage | verdict |
| --- | --- |
| ciChecks | passed |
| aiCheck | passed |
| similarity | passed |
| oracleNop | passed |
| qualityCheck | passed |
| easinessProbe (Calibration I) | passed, 0 of 5 solved |
| difficultyProbe (Calibration II) | passed |
| failureValidation (Run audit) | passed |

One warning stands and did not block: instruction 283 words against an
advisory 250. Do not push to this draft again.

Shipped shape: solution +610 over 11 files, held-out 740 lines over 2 files,
instruction 283 words, f2p 60, p2p 62, 2.16 lines per instruction word.

The hardening added after the submission that passed (the loader exiting on a
graded name already in `sys.modules`, and the `co_filename` origin check on
every case) is in the work tree and in `verifier/child.py`, NOT in the draft.
It is worth carrying into the next task on this repo, not worth a push here.
