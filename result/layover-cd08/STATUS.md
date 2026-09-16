# layover — arrive-by-search

Tree `/root/mindriftwork/AQ_dragan/result/layover-cd08`, session cd08c3ef.
Snapshot `snapshot.borrower-v2-g1788476571484294.zip`, unpacked to `repo/`.
Shared slate: `../layover-SLATE.md`. Second slot on this repo is `fare-capping`
(session 88d6b32f, tree `result/layover-4294`).

## The codebase

`layover`, a timetable and journey planning engine for scheduled transport.
Python 3.10+, **standard library only, no dependencies**, 135 files, 18.7k lines.
Suite is `unittest` (`make check` runs `python -m unittest discover -q -s tests -t .`),
1808 cases, green locally in 6.5s under pytest as well.

Ten layers, `docs/design.md` holds the table and `tests/test_package.py` fails the
suite if an import crosses it. `plan` is layer 4.

House rules the base suite enforces over every module, new ones included:
docstring on module, class, function and public method; `__all__` present, sorted,
no repeats, every name existing; no `>>>`; no star imports; no clock, no
`os.environ`, no `random`, no `uuid4`; file ends with a newline.

## Step 0 — can it be graded

Local half: **green**. Stdlib only, `pyproject.toml` has `dependencies = []`, and
the suite is `unittest`, so the verifier image's bare python3 is enough. The
account-updater failure mode (generator installs nothing, repo needs deps) cannot
bite here.

Platform half: **blocked, waiting on a draft.** No task exists on this repo yet,
so `gold.repos.list` gives nothing and there is no repo id to run `envs` /
`env-log` against. Runs the moment the user hands over a draft URL.

## The gap

README gap 3 of 15, quoted whole:

> **Arrive by search.** Planning backwards from a time you have to be there,
> which is not the same search run in reverse.

Proposed name `arrive-by-search`, category `feature_request`.

## Log

- 2026-09-06 07:53 unpacked, suite run, 1808 pass.
- 2026-09-06 07:57 claimed on the slate, file set agreed with session 88d6b32f;
  they gave up `session.py` and `cli/*` to me and keep `fares/*` and `feed/*`.
- 2026-09-06 08:0x proposal sent to the user, waiting on a draft.

## Build, 2026-09-06

Draft `CkOt8OFfbLefPFtLNkQU`, repo `0HcbI5k5rvuBjtv6qrPb`, base
`9d908c2ce1d35effb464d5eaa2c21813bd6fca18`, env v1
`gold-repo-layover-0hcbi5:v1`. Category `feature_request`.

**Step 0 proved.** The environment image is `python:3.12-slim` + git + `COPY
repo/ /app` and installs nothing else, so there is **no pytest**. The repo is
stdlib only and its suite is `unittest`, so that is enough: rebuilt locally from
the seven `Step` lines, the base suite runs 1808 green with `--network none`.

**The feature.** README gap 3, "Arrive by search". New
`layover/plan/backward.py` holding `BackwardSearch` and `plan_arriving_by`;
`Session` gains `latest_departure`, `reaching`, `plan_arriving_by` and
`arrive_by_report`; `report/journey.py` gains `arrive_by_report`; the CLI gains
`arrive`. Docs, README gap list and `tools/bench.py` updated with it.

Where the difficulty lives, all of it invisible to anything the repo ships:

- rounds run from the destination outward and every label holds the LATEST
  moment a stop may be left, so the pruning comparison is the other way round;
- a pattern is walked from its last call down, so alighting is what a round
  enters by and boarding is what it leaves by, the opposite flag at each end;
- `min_transfer_seconds` sits between two rides only, subtracted rather than
  added, and a walk needs none;
- declared transfers are directional and `Network` indexes only
  `transfers_from`, so a backward walk needs the other index built;
- the journeys come from a forward search run from the moment the backward
  pass found, which is the README's own "not the same search run in reverse":
  the backward reconstruction would have a passenger dawdle at every change.

**Sizes.** solution +658/-28 over 12 files, tests +672 over 2 files, 83 f2p,
1807 p2p, instruction 297 words, 2.22 lines per word. All floors green.

**Verified.** `local/verify_task.sh`: base reward 0 with 83/83 f2p present and
0 passing, solution reward 1 with 1807/1807 p2p. `local/mutants.py`: 23 of 23
mutations caught. `local/attack_matrix.sh`: see below.

The one p2p id left out is
`tests.test_package.TestSuiteTest.test_every_test_module_has_a_docstring`: it
imports every module in `tests/`, so it cannot pass until the feature exists,
and a p2p id that fails for want of the feature reads as a broken base test.

**Verifier.** Publisher/runner split ported from
`AQ_alexandra/result/tappet/tasks/signal-aspects`, with the unprivileged child
and the `/tests` protection from `sectional-release` added: the runner lives in
a world readable directory (0755) while the reports stay root only (0700),
because the `nobody` child has to read it.

**Result: PASSED all eight stages on the first submission, 2026-09-06.**
ciChecks, aiCheck, similarity, oracleNop, qualityCheck, Calibration I (1 of 5
solved), Calibration II, run audit. Status `Needs Review`. One non-blocking
ciChecks warning: instruction 297 words against a recommended 250. Do not push
to this draft again.
