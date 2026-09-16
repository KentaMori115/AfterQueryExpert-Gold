# nested-queries (subqueries in expressions)

Draft `V6ZjSgYCTQdKodMKrSjt` on repo `2Z9OHwYvfPnfAYyrEo0D`, base
`928c0b74375a634051b81bae1e4032c9e4c86ac7`, environment v3.

**The draft is named `set-operations` and this task is not that.** The name was
chosen before three sessions collided on the same gap; a peer session had
already built set operations, so this slot moved to subqueries, and a task name
cannot be renamed. Content, instruction and display fields all say subqueries.

## What the task asks for

Subqueries in expressions: a parenthesized `SELECT` read as a value, `EXISTS`,
and `IN` / `NOT IN` over a query, correlated one level out. `FROM` still takes
tables alone.

## Where the difficulty sits

`exec::eval::eval(&BoundExpr, &Row)` takes no catalog and no enclosing row, so
expression evaluation in tanager is context free by construction. Answering a
correlated subquery means threading an execution context through `eval`,
`predicate`, `agg_exec`, `sort_exec`, `join_exec`, the INSERT path in `api.rs`
and constant folding. Three rules then collide with what the repo already
promises:

1. An outer reference is not a column of the row the expression sits on, so it
   is a variant of its own. `required_width` and `column_range` must not count
   it, or a correlated predicate looks like it addresses columns that are not
   there.
2. A `WHERE` conjunct carrying an outer reference must not be pushed into a join
   input: after the move it would read a different row. Uncorrelated predicates
   still push, and both directions are graded, by plan shape and by rows.
3. Three-valued membership: a miss with a NULL candidate is unknown, so `NOT IN`
   never keeps a row while a NULL is among the candidates.

## Numbers

- solution: +581 / -44 over 15 files (floor 459 added, 4 files)
- held-out: +776 over `tests/nested_reads.rs` and `tests/enclosing_scope.rs`
  (floor 596 added, 2 files); test patch also carries the nine inherited graded
  suites so an agent's edit to one is reset rather than fatal
- 48 f2p, 80 p2p, instruction 290 words, 2.0 solution lines per word
- base suite 302 green before the change, 356 green with it

## Verifier

Ported from `result/fwctl/tasks/staged-activation` (passed all 8 stages
2026-09-04): compile every graded target separately, run the binaries directly
as `nobody`, planted canaries per graded file, content pins, refused footholds
(`build.rs`, toolchain files, `harness = false`, a cargo config naming a runner
or wrapper), and a converter that publishes every declared id, failing the ones
that never reported.

Local images are session unique (`tanager-1f45-env:v3`,
`tanager-1f45-verify:local`): docker tags are global on this box and four
sessions share it.

## Reserve

`instruction.short.md` is a 278 word variant, held in case quality review names
concision (ciChecks warned at 296 words against an aim of 250). It is not to be
pushed on a hunch: aiCheck passed on the shipped text, and a full re-voice has
failed that gate before. If concision is named, prefer editing the named clause
of the shipped text over swapping the whole file.

## Submission log

- 2026-09-05 19:17 submitted (1 of 3). ciChecks passed with one warning
  (instruction 296 words, aim 250), aiCheck passed, Originality passed.
- 2026-09-05 19:33 the user chose to re-cut under a matching name. `delete-draft`
  refuses anything past Draft and `reopen` only takes rejected tasks, so the route
  was: cancel the running probe, which turned the status terminal (the platform
  labelled the cancellation a platform error rather than a verdict), then
  `archive`. Archiving freed the repo slot.
- 2026-09-05 19:43 draft `V6ZjSgYCTQdKodMKrSjt` created as `nested-queries`,
  bundle rebuilt against ITS frozen files (task.toml carries task_id
  nested-queries), pushed and submitted (1 of 3). Same bytes otherwise: solution
  +581/-44 over 15 files, held-out +817 over 11 files, 50 f2p, 80 p2p.

## Round 2, after Calibration II said too_easy (8 of 8 solved)

Diagnosis came from the trial patches, not from guessing. All eight trials were
downloaded, applied to the base tree, built, and run against 31 probe queries
that the graded suite did not cover. Four probes split the builds, and two of
them were levers:

1. **A grouped query's frame.** Every trial refused a correlated subquery inside
   a grouped projection or HAVING, four of them with an invented error message
   saying it is unsupported. So did this task's own reference, which had a latent
   bug there: the subquery was bound against the aggregate's INPUT scope while
   the expression is evaluated over its OUTPUT row. Fixed by giving `AggCtx` a
   `grouped_scope` built from the grouping columns, which is the layout
   `docs/DESIGN.md` already documents, and stated as a rule.
2. **What `EXPLAIN` shows.** Six of eight invented a rendering for subquery
   plans, under four different labels (`Subquery`, `Subquery (correlated)`,
   `Subquery (scalar)`, `Subquery (in)`); two printed nothing at all. The shape
   is now specified: a `Subquery` line one step inside the operator that runs it,
   that query's plan beneath, inputs after.

Measured, not assumed: the new cases were run against all eight trial builds.
Six now fail, four on the grouped rule and two on the plan shape. Two still pass
everything, which is what a 1-to-6-of-8 band wants.

Sizes after round 2: solution +641/-44 over 15 files, held-out +977 over 11
files, 57 f2p, 80 p2p, instruction 298 words.
- 2026-09-05 also caught by the battery: `a_plan_without_a_query_inside_reads_as_it_always_did`
  passed at the BASE commit, since a plan with no subquery has no `Subquery` line
  either way. Given a positive control in the same case.
- 2026-09-06 01:5x resubmitted (2 of 3) with 57 f2p / 80 p2p, solution +641/-44,
  held-out +991.

## Round 3, after quality review failed on three criteria

- anti_cheating_measures and report_integrity shared one cause: cargo compiled as
  root, so a manifest naming a build script, a proc macro or a workspace member
  got compile-time code execution as root, and the digest check noticed the
  changed grader but the frame then ran it anyway. Fixes: the private build copy,
  the target dir and a private CARGO_HOME are chowned to the drop user and the
  compile itself runs under setpriv; the manifest scanner refuses `build = `,
  `proc-macro = true` and `[workspace]`; and a root-only pristine copy of
  grader.py and config.json is taken before any submitted code runs and restored
  at the end of the block. New attack rows named_build_script,
  proc_macro_library and workspace_member all score 0/0.
- behavior_in_tests: the EXISTS promise was stronger than the reference (it does
  run the projection), so the promise now says the rows are produced as usual and
  a case proves an error inside surfaces. INSERT values, an ORDER BY key and a
  GROUP BY key are graded, since the instruction claims a subquery sits anywhere
  an expression may.
- Two harness lessons, both cheap and both cost a round here: a battery needs
  disk per ROW, not per lane (28 rows filled a 12 GB disk and five rows then
  reported every id as failed with an empty log), and never edit verify_task.sh
  while a run of it is in flight, since bash reads a script incrementally and the
  running shell reads the shifted bytes.
- 2026-09-06 submitted (3 of 3) with 61 f2p / 80 p2p, held-out +1040.
