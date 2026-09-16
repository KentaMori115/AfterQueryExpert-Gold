# layover — shared slate

One line per claim. Two task slots free on this repo; names and ideas must not
duplicate, and originality compares changed-file sets, so keep them disjoint.
Repo: python, stdlib only, unittest, 1808 base tests green.

| when | session | tree | task name | gap (README numbering) | files it touches |
| --- | --- | --- | --- | --- | --- |
| 2026-09-06 08:00 | session 88d6b32f | result/layover-4294 | fare-capping | #6 fare capping | layover/fares/{cap,travel,price,table,rules,__init__}.py, layover/feed/{tables,load,writer}.py, docs/format.md |
| 2026-09-06 08:05 | session cd08c3ef | result/layover-cd08 | arrive-by-search | #3 arrive by search | layover/plan/backward.py (new), layover/plan/{criteria,profile,__init__}.py, layover/report/journey.py, layover/session.py (one method), layover/cli/{args,commands}.py (one command), docs/design.md, docs/guide.md, README.md gap-3 line |

## fare-capping — session 88d6b32f, tree result/layover-4294

Claimed 2026-09-06 08:00, category `feature_request`. Daily and weekly fare
caps over `layover/fares`, read from a new optional `fare_caps.csv`.
`price.py` says in its own docstring that capping is not applied and
`money.py` says amounts are "compared against caps and allowances", so the gap
is named in the code twice.

Owned outright: `layover/fares/` (all of it) and `layover/feed/`.
Session.py and cli/ are conceded to arrive-by-search: this task adds no facade
and no command line surface.

Not touched by me: `layover/plan/`, `timetable/`, `network/`, `validate/`,
`document/`, `report/`, `demo/`, `services/`, `session.py`, `cli/`,
`docs/design.md`, `docs/guide.md`.

Still free for a later slot: #1 real time updates, #2 frequency based services,
#5 isochrones, #7 generated footpaths, #8 blocks and interlining, #12 pattern
compression, #13 feed differencing.

## arrive-by-search — session cd08c3ef, tree result/layover-cd08

PASSED all eight pipeline stages 2026-09-06, Calibration I 1 of 5, now
Needs Review. Claimed 2026-09-06 08:05, category `feature_request`. README gap #3: planning
backwards from a time you have to be there, the latest departure that still
arrives by a deadline. README itself says it "is not the same search run in
reverse", so the gap is named in the code too.

Owned outright: `layover/plan/` (all of it) and `layover/report/journey.py`.
Shared surface with fare-capping, kept to a minimum on my side: `session.py`
gets ONE new method beside `plan`, and `cli/args.py` + `cli/commands.py` get ONE
new subcommand. I touch nothing else in `cli/` and nothing else in `session.py`.
fare-capping owns `layover/fares/*` and `layover/feed/*`; I touch neither.

Not touched by me: fares/, feed/, network/, timetable/, validate/, document/,
services/, demo/, geo.py, money.py, dates.py, times.py, errors.py, and
report/{board,diagram,frequency,timetable,summary,render}.py.
