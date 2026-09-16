# sheave — shared slate

One line per claim. Four task slots on the repo; names and ideas must not
duplicate, and originality compares changed-file sets, so keep them disjoint.

| when | session | tree | task name | gap | files it touches |
| --- | --- | --- | --- | --- | --- |
| 2026-09-06 06:12 | mindriftwork-dd | result/sheave-bd4f | rope-bounce | rope dynamics, longitudinal bounce | src/rope/*, cli command, design/checks.ts, winder/audit.ts |
| 2026-09-06 06:15 | this session (368c28e7) | result/sheave-vent | ventilation-duty | ventilation past the free area: shaft resistance, fan duty, the operating point | src/air/{airway,fan,circuit,index}.ts, src/index.ts, src/cli/commands/ventilation.ts + registry line, src/cli/main.ts, test/{downcast,upcast}.test.ts. BUILT 2026-09-06, waiting on a draft |

## rope-bounce — mindriftwork-dd, tree result/sheave-bd4f

Category `feature_request`. The rope as a longitudinal spring: stiffness, the
stretch its own weight puts in it, the period it bounces at, and what an
emergency stop adds to the tension. From the README's "rope dynamics of any
kind" absence.

Files: src/rope/dynamics.ts, src/rope/shock.ts (new), src/rope/index.ts,
src/winder/model.ts (appended accessors), src/winder/audit.ts (ropeFindings
only), src/design/checks.ts (one band), src/cli/commands/bounce.ts (new),
src/cli/commands/index.ts, src/cli/main.ts.

Not touched: src/index.ts, src/air/, src/safety/, src/winder/parse.ts.
