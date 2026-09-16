# schwabbot (SchwabOptionBot, Django 5.1.5) — session bca513ba

Snapshot: `snapshot.borrower-v2-g1788454187585206.zip`, unpacked at `repo/`.
Base suite: `python3 manage.py test` → **62 tests, OK** inside the platform env
image (Django 5.1.5, pytz, channels all present — Step 0 clears).

## Claim (session bca513ba, 2026-09-06)

- task name (proposed): `reset-code-approval`
- category: feature_request
- changed-file set claimed (all inside `Users/`, nothing else):
  - `Users/resetcodes.py` (new)
  - `Users/resetwindow.py` (new)
  - `Users/forms.py`
  - `Users/views.py`
  - `Users/models.py` + new `Users/migrations/0005_*`
  - held-out tests under `tests/`
- idea: `UserPwdRequest.secret_code` and `.call_count` are dead — the admin page
  shows both, but the reset flow never asks for the code and never counts a
  wrong one. Feature makes the code real: step 2 must present it, a wrong code
  burns an attempt, a spent budget revokes the request (re-queue + fresh code),
  and an approved code expires at market close (US/Eastern, weekend rollover).

**NOT** claimed, left to peers: `Engine/*`, `BotList/*`, `AdminCustom/*`,
`Users/allow.py`, `Users/middleware.py`, `Users/templates/*`.

Other sessions on this repo:
- mindriftwork-c6 (`schwabbot-9c1f`): `risk-budget` — Engine/risk.py,
  Engine/server_api.py, BotList/models.py, AdminCustom/views.py + urls.py.
  Disjoint from this claim.

## Build record

Repo id `62K48OhILrG3idHZAX17` (`/SBot_V3.18`), base
`7bc88a1c75c331045b5714ee4a411e0321efc5a1`, env
`gold-repo-sbot-v3-18-62k48o:v2` (env version 2, v1 build_failed).
Draft `3sgULaBMtqSRreFKpJfN`.

**Step 0.** `env-log 62K48OhILrG3idHZAX17 2` reads
`FROM python:3.12-slim`, git, `COPY repo/ /app`,
`ENV SBOT_OFFLINE=1 DJANGO_SETTINGS_MODULE=SchwabOptionBot.settings`,
`pip install` of the whole requirements list, then `git config`. No pytest, so
the verifier drives Django's own runner. Base suite in a local rebuild of
those Step lines: 62 tests, OK, `--network none`.

**Numbers.** solution +521/-27 over 9 files, tests +641 over 2 files,
instruction 278 words, 45 f2p, 62 p2p, 1.87 solution lines per word. All
floors ok.

**Gotcha worth keeping.** One installed dependency ships a top level `tests`
package into site-packages, so a runner that appends `/app` to `sys.path`
imports *that* and reports 14 of 62 cases. The child puts `/app` first, the
way `manage.py` does, after the framework is already imported and guarded.

## Pipeline rounds

1. quality_check — behavior_in_tests (`created_at` never asserted on the third
   miss) and f2p_p2p_consistency (`new_secret_code()` could redraw the code it
   replaces while five tests assert it changed). Fixed with `avoid=` and the
   missing assertions.
2. quality_check — anti_cheating: an import hook installed through
   `django.setup()` could rewrite the graded modules. Reproduced as attack a11,
   which scored 43 of 47 f2p on a feature-less tree. Fixed by compiling the
   graded modules before `django.setup()` and guarding `sys.meta_path`.
   Also behavior_in_tests (a required `secret_code` was never tested) and
   file_reference_mentioned (`/accounts/forgot_password/` was not named).
3. difficulty_probe too_easy, 8 of 8. Calibration I 0 of 5. The trial reports
   showed the lazy `approved_at` stamp was the only thing resisting, so two
   observed-transition rules went in: a withdrawn approval, and a second
   approval worth one try.
4. quality_check — behavior_in_tests (the reset page never tested reuse depth
   2 to 5), plus warnings on length and on three test titles reading as
   instruction sentences. Fixed, renamed nine tests, instruction cut to 251.
5. difficulty_probe out_of_band_hard, 0 of 8. Every trial passed 115 of 116 and
   failed the same id, `test_reapproval_allows_a_single_miss` — the signature
   of an unstated contract. Cutting to 251 words had compressed that rule to
   "Switched on again, a request is worth a single try", which never says what
   is counted or that going back leaves the count alone.
6. Round 5's rule restated in full, and a minimum notice added to the deadline:
   a bell counts only two hours out, so a 15:59 approval misses that day and a
   Friday 15:00 approval lands on Monday. 57 f2p / 62 p2p, 25 of 25 mutants
   caught, 12 of 12 attacks defended, instruction 288 words.

**Round 6 passed all eight stages 2026-09-06 06:06, status Needs Review.**
Calibration I 0 of 5, Calibration II in band, run audit pass. One warning left
standing: instruction 288 words against a recommended 250, kept deliberately —
the 251-word version is what scored 0 of 8.
