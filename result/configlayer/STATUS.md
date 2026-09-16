# configlayer — build log

Codebase assigned to the `dimon.paukow` (dragan) seat. Python, deterministic
layered-configuration engine. Four tasks were authored and submitted on
2026-08-28 by an earlier session; **all four failed stage 1 for the same
mechanical reason** and none of them ever reached `aiCheck`.

## Facts

| | |
| --- | --- |
| repo id | `vFYM9eXovPIRZPvmdXnN` (name `configlayer`) |
| base commit | `dd49c9a17543604fb728e10cbb7e3b3201355d10` (equals `headSha`) |
| environment | version 1, `gold-repo-configlayer-vfym9e:v1` |
| assignment | `OdXUVxxTbbotZvcGSJFg` |
| repo snapshot | **not on this box** — bundles were recovered with `gold_bot.py pull` |

`repos.get` returns `repoUrl = ""` for an assigned repo, so `repository_url`
in `task.toml` is the platform form `platform://gold/repos/<repoId>`, the same
value the two seats that have passed all eight stages use.

## The four submissions

| id | task | verdict |
| --- | --- | --- |
| `A7ObMvemQHZTiKfYhAqI` | config-query | ciChecks failed; repaired 2026-08-28, awaiting submit |
| `uSd0Pu7r6WH1BPNs5pb7` | config-export | ciChecks failed, same cause, not yet repaired |
| `LNjHiwn8LiKgkTXRLNHP` | typed-config-view | ciChecks failed, same cause, not yet repaired |
| `45GqEqGfaVlE3vIBtVN5` | yaml-config-files | ciChecks failed, hand-written frame, not yet repaired |

## Round 1: the whole `task.toml` frame was overwritten

`config-query`, `config-export` and `typed-config-view` each stored a 217–224
byte `task.toml` holding nothing but

```
display_title = "..."
display_description = "..."
```

and no `environment/Dockerfile` at all. `gold.tasks.get` confirmed it:
`taskToml` came back with every one of its fifteen fields `null`, and
`files.read` on `environment/Dockerfile` returned `content: null`.

That is the `task.toml.lines.txt` mistake. `task.toml.lines.txt` is the short
note of the values a task contributes; `task.toml` is the full frame the
platform validates. Writing the note into the real file and pushing it replaces
the frame, and every `[agent]`, `[verifier]`, `[environment]` and `[metadata]`
check then reports "got nothing".

Both files are recoverable without a fresh draft:

- **`task.toml`** is a fixed frame. The only per-task values are `name`,
  `task_id`, `display_title`, `display_description`, `category`, `language`,
  `repository_url`, `base_commit_hash` and `docker_image`.
- **`environment/Dockerfile`** is a generated four-line reference copy — three
  comment lines that are byte-identical on every seat and repo, then a single
  `FROM <published image>`. It is *compared*, not re-generated, so it must be
  restored exactly; a hand-written build (what `yaml-config-files` did) is
  rejected as `environment-dockerfile-modified`.

`gold.tasks.save` does not delete files it is not sent, and every generated file
round-trips byte-identically through `pull`, so the repair is a normal full-bundle
push.

## Round 1 also: `codename-hit`

`yaml-config-files` alone drew `Bundle contains blocked internal terms:
afterquery`. The only occurrences in that bundle are the platform's own mandated
values — `[task] name`, `[environment] docker_image` and the `FROM` line of the
generated `tests/Dockerfile` — and tasks carrying exactly those values have
passed all eight stages on two other seats this week. The reading that fits: the
scan exempts the generated files and the mandated `task.toml` values, and that
bundle lost the exemption because its `task.toml` failed validation
(`repository_url = ""`) and its `environment/Dockerfile` was hand-written.
Restoring both should clear the codename finding with it. Unconfirmed until a
run says so.

## config-query, what was changed 2026-08-28

Blocking:

1. `task.toml` rewritten as the full frame.
2. `environment/Dockerfile` restored as the generated reference copy for
   `gold-repo-configlayer-vfym9e:v1`.

Advisory, fixed in the same push:

3. ciChecks warned that three held-out test titles appeared nearly verbatim as
   sentences in `instruction.md` — "document order follows the mapping not the
   patterns", "matched interior mapping is reported whole", "prune leaves
   emptied mappings in place". An instruction that restates the test list reads
   as derived from the tests. All three sentences were rewritten as behavioural
   prose; no stated requirement was dropped and every named symbol
   (`select`, `first`, `paths`, `values`, `pick`, `prune`, `Query.matches`,
   `select_origins`, `Match`, `OriginMatch`, `ConfigError`, `CHANGELOG.md`)
   still appears. 282 words -> 277.

Advisory, left alone:

4. `solution.patch` adds 486 lines, below the recommended 525. Raising it means
   writing real code against a repo snapshot this box does not have, and the
   floor (459) is met. It rides to the reviewer as a warning, the same way the
   size warning did on the two tasks that passed elsewhere.

Floors after the repair, all green: solution 486/8, tests 609/5, instruction
277 words, f2p 58, p2p 1386, 1.75 lines per word.

Nothing downstream of stage 1 has ever run on this task, so difficulty,
originality and reference verification are all still unmeasured.

## Round 2, 2026-08-28: quality review

Submitted at 17:08 after the frame repair. **ciChecks, aiCheck, similarity and
oracleNop all passed** — the first time anything on this seat got past stage 1.
`qualityCheck` failed on six criteria, which collapse into two real causes.

### Cause 1 — the suite pinned three things the instruction never promised

Cited under `behavior_in_task_description`, `behavioral_test_surface`,
`implementation_acceptance_breadth` and `instruction_self_containedness`: a
`Query.patterns` accessor, the exact string `Query([a.*, **.b])` from `__repr__`,
and membership in `__all__`. A behaviourally correct alternative could omit the
accessor or choose a different repr and still be rejected, which is the
acceptance-breadth failure exactly.

Fixed by removing the pins, not by documenting them — an exact repr is an
incidental reference-implementation choice and does not belong in a spec:

- `test_query_exposes_compiled_patterns` -> `test_query_from_strings_equals_query_from_key_patterns`,
  which asserts the same thing (strings get compiled to `KeyPattern`) through
  behaviour alone: a query built from strings and one built from equivalent
  `KeyPattern` objects select identically.
- `test_query_repr_lists_its_patterns` deleted; class `TestRepr` renamed
  `TestRecords` since only the `Match` dataclass test remained in it.
- `test_package_exports` no longer asserts `__all__` membership, and
  `test_top_level_re_exports` now asserts identity —
  `configlayer.select is configlayer.query.select` — which is what "re-export"
  means and is what the instruction promises.

The solution keeps `Query.patterns` and `__repr__`. They are simply no longer
graded, so an alternative build is free to differ.

### Cause 2 — reward did not enforce three things the instruction did promise

`behavior_in_tests`: no test required the promised `CHANGELOG.md` update, the
no-aliasing guarantee was under-enforced, and `Query`'s methods were not held to
the module functions' input semantics. That last one was a **real defect in the
reference solution**, not just a test gap: `Query.select` called `walk_matches`
directly, bypassing the `isinstance(config, Mapping)` guard, so
`Query("db.*").select(7)` raised `AttributeError` where `select(7, "db.*")`
raised `ConfigError`. The solution now routes every read operation through the
module-level `select`, and the instruction states the contract in one place.

Nine tests added, all mutation-tested against a deliberately broken build before
being kept:

| test | mutant it catches |
| --- | --- |
| `test_query_read_methods_reject_a_non_mapping` | `Query.select` bypassing the guard |
| `test_query_transforms_reject_a_non_mapping` | same, for `pick`/`prune` |
| `test_query_errors_match_the_module_function_errors` | any divergence over four bad inputs |
| `test_changelog_records_the_new_package` | CHANGELOG left at base |
| `test_pick_copies_every_nested_container` | `_copy` returning containers by reference |
| `test_prune_result_survives_later_input_mutation` | same |
| `test_prune_copies_list_values` | same, list branch |
| `test_query_from_strings_equals_query_from_key_patterns` | patterns not compiled |
| `test_top_level_re_exports` (rewritten) | top-level name rebound to another object |

The existing `test_pick_does_not_alias_the_input` **passed** under the
reference-returning `_copy` mutant, which is precisely the under-enforcement the
reviewer described.

### Cause 3 — anti-cheating: the finding's premise was wrong, the gap was real

The finding said `config.json` lists `frozen_files` and `protected_absent` but
"grader.py never validates either list". That is false as written: `cmd_grade`
calls `verify_pins(cfg["frozen_files"])` and a mismatch zeroes the reward, and
`cmd_prepare` deletes every `protected_absent` name. The **example** it gave was
right, though — `protected_absent` held only four root-level pytest files, so a
committed `sitecustomize.py` would be imported at interpreter start-up
(`PYTHONPATH=/app`), before the suites and again before the grader.

Two changes, neither of which touches `grader.py`:

- `protected_absent` extended to `sitecustomize.py`, `usercustomize.py`,
  `tests/conftest.py`, `tests/query/conftest.py`. `frozen_files` proves none of
  these names exists at the base commit.
- A sweep inside `test.sh`'s RUN TESTS markers finds those names **anywhere**
  under `/app`, asks `git cat-file -e <base_sha>:<path>` whether each is tracked
  at the base commit, keeps the ones that are and removes the rest. Removal
  only, every step optional; exercised in a sandbox, and the frame above and
  below the markers is still byte-identical to `original_test.sh`.

### Verification before the push

No repo snapshot exists on this box, so the query package was executed against a
stub `configlayer` (a `KeyPattern` written to the documented semantics, a
minimal `LayeredConfig`). 50 of the 58 original tests passed against it before
any edit — the 8 failures are all real-`LayeredConfig` API the stub does not
model — which is what makes the stub trustworthy for everything else. After the
edits: 56 of 64, same 8.

Also re-checked: the regenerated patches round-trip through `grader.py`'s own
`parse_patch`; all five `held_out_files` sha256 pins match the reconstruction;
the 64 f2p ids come from a real JUnit report, not by hand; no f2p/p2p overlap;
every f2p id lives in a file `F2P_FILES` actually runs.

Floors after round 2: solution 493/8, tests 671/5, instruction 288 words
(cap 300), f2p 64, p2p 1386, 1.71 lines per word. Pushed at head; awaiting submit.

## Round 3, 2026-08-28: the mistake was mine, twice

Five of six quality criteria passed. `anti_cheating_measures` failed again, with
the same sentence as round 2: "grader.py never reads or checks held_out_files,
frozen_files, or protected_absent."

Round 2 dismissed that as a misreading, because the `tests/grader.py` in this
bundle plainly does read all three. **The bundle's grader.py is not the
platform's grader.py.** One command settles it:

| bundle | bytes | sha256 |
| --- | --- | --- |
| quire / transit-routing | 13113 | `97da2658c01ed279` |
| quire / account-merge | 13113 | `97da2658c01ed279` |
| baseforge / symbol-repair | 13113 | `97da2658c01ed279` |
| wayline / vehicle-blocks (other seat) | 13113 | `97da2658c01ed279` |
| **configlayer / all four** | **17554** | `a528c426b0d39145` |

Byte-identical across three repos, two languages and two seats — that is the
platform's shared verifier, and its own docstring says so: *"This file is
identical across tasks — modified copies are rejected at submission."* It reads
exactly four keys — `base_commit`, `f2p_node_ids`, `p2p_node_ids`, `grade` — and
has never heard of `held_out_files`, `frozen_files` or `protected_absent`.

An earlier session on this seat replaced it with a 491-line custom grader that
invented those three keys. So the pins in `config.json` were decorative, the
reviewer was reading the real grader, and it was right both times. Round 2 also
left a comment in `test.sh` asserting that grader.py verified the pins, which
the round-3 finding quoted back.

### The fix

`tests/grader.py` restored to the canonical 13113-byte file, and every integrity
guarantee moved into `test.sh` between the RUN TESTS markers, where it is
task-owned, actually executed, and legible to a reviewer:

1. every `frozen_files` path is restored from the base commit with
   `git checkout <base> -- <paths>`, so an edit to the repository suite that
   backs the p2p ids does not survive to be run;
2. every `protected_absent` name is deleted wherever it sits under `/app`
   unless `git cat-file -e <base>:<path>` vouches for it;
3. **new** — any `.py` at the repository root whose stem is in
   `sys.stdlib_module_names` and is not tracked at base is deleted.
   `PYTHONPATH=/app`, and `/app` is on `sys.path` for
   `python3 /tests/grader.py` as well, so a committed `json.py` would be
   imported by the grader itself;
4. every sha256 pin in `frozen_files` and `held_out_files` is re-checked, and a
   mismatch that survived the restore writes `reward.json` with reward 0 and
   stops before any suite runs.

The checker runs as `python3 -I` for the same reason as (3): without isolation
the script meant to detect a shadowing module could be run through one.

### What was verified this round, rather than assumed

Round 2's error was reasoning where it could have measured. This round:

- **`git apply --check` on both patches.** The canonical grader applies with
  `git apply`, not the tolerant hand parser the custom grader used, so the
  regenerated patches had never faced the real applier. Pre-images for the two
  modified files were reconstructed from their own hunks; both patches check
  and apply clean.
- **The canonical grader run end to end** on a synthetic base: `prepare`
  applies `model.patch` then `test.patch`; `grade` returns
  `reward 1, f2p 64/64, p2p 1386/1386` with all-pass reports and `reward 0,
  f2p 0/64` with the base reports. Our `config.json` is compatible as written.
- **Seven sandbox scenarios for the integrity block**: clean; p2p test edited
  (restored, no effect); `sitecustomize.py` and a nested `conftest.py` planted
  (removed); held-out file altered with no base preimage (graded 0, exit 9);
  root `json.py` shadowing the stdlib (removed, and a legitimate
  `configlayer/json.py` left alone); git absent (degrades, still runs); git
  absent *and* a p2p test edited (graded 0).
- Frame above and below the RUN TESTS markers still byte-identical to
  `original_test.sh`; `frozen_files ∩ held_out_files` empty, so the restore
  cannot clobber the held-out tests; the 64 f2p ids still match a real JUnit
  report; all five held-out pins still match the patch reconstruction.

Floors unchanged: solution 493/8, tests 671/5, instruction 288 words, f2p 64,
p2p 1386. Pushed; awaiting submit.

### The lesson

A finding repeated verbatim after a fix is not the reviewer failing to notice —
it is the fix having missed. Before deciding a reviewer is wrong about a file,
check whether the file being reviewed is the file being shipped.

---

## Round 4, 2026-08-28: quality review, `anti_cheating_measures` + `report_integrity`

Both findings, one hole. `test.sh` ran the suites as `python3 -m pytest` with
`/app` as the working directory, and `-m` puts the working directory at the
front of `sys.path`. A submitted `pytest.py` or `pytest/` package is therefore
imported *as the framework*: it reads `/tests/config.json`, writes both
configured JUnit reports with every f2p and p2p id marked passing, and exits 0.

Demonstrated before fixing anything, against the command as shipped: a 20-line
`pytest.py` produced a report with **1450 fabricated passing entries** — 64 f2p
plus 1386 p2p — and exit status 0. Round 3's integrity block did not cover it:
it deleted root `.py` files whose stem was in `sys.stdlib_module_names`, and
`pytest` is not in the standard library.

### The fix

1. **The shadowing rule is now about what the verifier imports, not about the
   standard library.** The integrity checker already runs under `python3 -I`,
   so its own `sys.path` is the standard library plus site-packages and nothing
   else — listing it names exactly the set a file dropped at `/app` could
   displace. Any root-level `X.py` or `X/` package with a colliding name goes,
   unless `git cat-file -e <base>:X` vouches for it as the repository's own.
   The framework's own names (`pytest`, `_pytest`, `pluggy`, `iniconfig`, `py`,
   …) are removed even when git cannot be asked, since they could never be a
   name this repository owns.

2. **Each suite runs in its own `python3 -I` process** through
   `$SCRATCH/run_suite.py`. Isolated mode drops the working directory, the
   script's directory and `PYTHONPATH`, so pytest resolves from the image.
   The runner does not trust that ordering: it checks `pytest.__file__`,
   `_pytest.__file__` and `pluggy.__file__` and refuses with exit 9 if any of
   them is under `/app`. Only *after* the framework and the JUnit writer's own
   XML parser are bound does `/app` go on `sys.path` — at the **front**, so the
   tests still grade the package the agent worked on rather than a copy the
   image may have installed.

3. **The report is written by the process that ran the tests, from that run.**
   A plugin tallies one entry per test that reached its call phase or failed
   before it, plus one per failed collector; the runner compares that with the
   `<testcase` count in the file pytest wrote, writes the verified bytes into
   `/logs/verifier` itself, and records their sha256.

4. **The runner leaves through `os._exit`**, skipping atexit handlers and
   thread finalizers — a submission is free to register one, and the report is
   the obvious thing for it to rewrite. `test.sh` then re-reads both reports in
   a fresh process and compares them with the digests the runner recorded.

5. Exit 9 from either run, or a digest that no longer matches, writes
   `reward.json` with reward 0 and stops before grading.

### Verified, twelve scenarios

| # | scenario | outcome |
|---|---|---|
| 1 | clean solved tree | 64 f2p cases run, 64 in the report, digests match |
| 2 | `pytest.py` planted | removed; genuine run proceeds |
| 3 | `pytest/` package planted | removed; genuine run proceeds |
| 4 | root `json.py` planted | removed; `configlayer/json.py` kept |
| 5 | root module the repo owns whose name is in site-packages | kept, tracked at base |
| 6 | same, git unavailable | `pytest.py` still removed, repo's own name kept |
| 7 | submission registers an atexit report rewrite | never runs; the 8 real failures survive |
| 8 | report rewritten after its run | digest mismatch, graded 0 |
| 9 | a p2p test edited | restored from the base commit |
| 10 | a held-out test altered | graded 0 before any suite runs |
| 11 | `sitecustomize.py` + nested `conftest.py` | both removed |
| 12 | runner refuses (exit 9) | `reward.json` reward 0, grading skipped |

Also re-checked: the runner's tally matches the report on a **collection-error**
run too (base tree, no `configlayer.query`: 3 errors, 3 cases), so the count
cross-check does not misfire on the reference-verification run; the frame above
and below the RUN TESTS markers is still byte-identical to `original_test.sh`;
`grader.py` is still the canonical 13113-byte shared file
(`97da2658c01ed279`). `pytest.py` added to `protected_absent`.

Floors unchanged: solution 493/8, tests 671/5, instruction 288 words, f2p 64,
p2p 1386, bundle 206241 bytes. Pushed; all 11 stored files pulled back and
compared byte for byte. Awaiting submit.

### The lesson

"The tests are pinned" is not the same as "the framework that runs them is the
verifier's". Everything round 3 hardened was an *input* to the run; the run
itself still resolved its framework from a directory the submission writes.

---

## Round 5, 2026-08-29: Calibration II, `out_of_band_hard` (0 of 8 solved)

Quality review, Calibration I and every earlier gate passed. Calibration II
failed the other way: 0 of 8, "solved too rarely to verify it sits inside the
accepted difficulty range."

### What the trials actually failed on

Downloaded `reward.json` and the f2p report for all 13 trials — 8 difficulty,
5 easiness — and classified every failure:

| probe | trial | f2p | failures |
|---|---|---|---|
| difficulty | 5My79J5 | 61/64 | 3 × `first` |
| difficulty | QeVDvdh | 61/64 | 3 × `first` |
| difficulty | 7MCxG2L | 59/64 | 3 × `first`, 2 other |
| difficulty | Fp3T8vk, XZcyf6Q, fwRJtad, kRLwZFg | 47/64 | 14 × container, 3 × `first` |
| difficulty | 8MsG9ft | 46/64 | 14 × container, 3 × `first`, 1 contract |
| easiness | fnzf2Md | 63/64 | 1 contract |
| easiness | WrHGMCq | 62/64 | 2 contract |
| easiness | DQVHSXt, LkzzUtN, sQyqnxc | 40-41/64 | 19 × container, 2 × `first`, contract |

**p2p was 1386/1386 in all thirteen.** Nobody broke the repository; every
failure was a guess about a representation the instruction never fixed:

1. `first` — the instruction called it a "convenience over" `select`, which
   returns `Match` records, so **8 of 8** difficulty trials returned
   `Match(path='db.password', value='pw-db')` where the tests want `'pw-db'`.
   That reading is at least as natural as the intended one.
2. the container — `select`, `paths`, `values` and `select_origins` returned
   tuples in 7 trials; the tests compare against lists. The word "frozen" in
   "frozen `Match` records" plausibly pushed them there.
3. `Match.path` — one trial made it a tuple of segments rather than the dotted
   string, and lost 19 ids to it.

None of that is the task's difficulty. It is an undefined noun, the exact
defect [[gold-define-every-term-you-coin]] describes: several different wrong
values across trials.

### The fix, and why nothing else changed

`instruction.md` only. Three sentences now pin what was ambiguous:

- "returns **a list** of frozen `Match` records, **the dotted path string** in
  `path`, the node in `value`";
- "`first(...)` **returns the first match's value or `default`**; `paths` and
  `values` return **lists** of the matched paths and values";
- "reports leaves, **a list** of frozen `OriginMatch` records".

Everything the quality review already passed — in particular "An invalid
pattern raises the same `ConfigError` it always did, as does a config that is
not a mapping" — is left exactly as it was, deliberately. That clause is what
separates the two probes: **all five** easiness trials fail
`test_pick_invalid_inputs_rejected` or
`test_query_read_methods_reject_a_non_mapping`, while 7 of 8 difficulty trials
get it. Strengthening its wording would have bought a Calibration I failure in
exchange for the Calibration II fix.

Replayed against the recorded trials, the pinned contract predicts
**difficulty 6 of 8 solved, easiness 0 of 5** — in band on both sides. The real
number will be lower, since some trials still have to act on the wording, which
is the direction with room.

288 words (12 under the cap; gold_bot's counter and a plain whitespace split
agree exactly). Solution, tests, `config.json`, `test.sh` and the f2p ids are
untouched, so nothing re-derived and nothing to re-verify. Pushed; all 11
stored files pulled back and compared byte for byte.

### The lesson

A probe that scores 61/64 and 63/64 is not failing the task, it is failing the
spec. Read the per-trial reports before touching the design: the fix here was
three sentences, and the alternative reading of "convenience over `select`"
would never have surfaced from staring at the instruction.

---

# config-export (task uSd0Pu7r6WH1BPNs5pb7)

## Round 1, 2026-08-29: ciChecks, 21 errors

The same frame fault config-query had: `task.toml` held the 220-byte
`task.toml.lines.txt` content instead of the real file, so every `[task]`,
`[agent]`, `[verifier]`, `[environment]` and `[metadata]` key read as missing —
one root cause, 20 findings — and `environment/Dockerfile` was gone entirely.
The bundle also carried the non-canonical 17554-byte `grader.py`
(`a528c426b0d3`) and the un-hardened `test.sh`.

### Repaired

1. `task.toml` rebuilt to the full 981-byte frame, keeping this task's own
   `display_title`/`display_description` and setting `task_id`/`[task] name` to
   `config-export`. Repo-level values (image, base commit, repository_url) are
   the ones config-query is running green with.
2. `environment/Dockerfile` restored byte-exact — the 4-line generated
   reference copy, compared against config-query's rather than hand-written.
3. `tests/grader.py` replaced with the canonical shared 13113-byte file
   (`97da2658c01ed279`).
4. `tests/test.sh` ported from config-query at 19237 bytes: base-commit restore
   of `frozen_files`, `protected_absent` removal, the shadowing-module sweep,
   sha256 pins, and the isolated `python3 -I` runner that checks where pytest
   came from and signs the report it writes. Only `F2P_FILES` differs. Frame
   above and below the markers verified byte-identical to `original_test.sh`.
5. `protected_absent` extended to 9 names including `pytest.py`,
   `sitecustomize.py`, `usercustomize.py` and `tests/export/conftest.py`.

`frozen_files` (73), `base_commit`, the 1386 p2p ids and the `grade` block are
byte-identical to config-query's, which ran 1386/1386 p2p across 13 probe
trials — so those are validated by production, not by assertion.

### Verified, not assumed

This task had never passed ciChecks, so nothing downstream had ever run on it.

- **The reference solution passes its own tests: 64/64.** Extracted both
  patches, stubbed the repo surface the tests reach (`exceptions`, `secrets`,
  `env.parse_env`, `loader.INILoader`/`load_file_like`, `source.DictSource`/
  `FileSource`, `layers.LayeredConfig`) to documented behaviour, and ran.
- **All 64 f2p ids fail at the base** and each reports individually — the
  imports sit inside the test bodies, so a missing `configlayer.export` does
  not abort collection and hide ids behind a convincing count.
- **The ids match a real pytest JUnit report**, classname.name, 64 for 64, not
  just an AST walk of the files.
- **Both patches apply with real `git apply`** onto a base reconstructed from
  the hunks' own context lines, padded so every hunk lands at its recorded line
  number; held-out pins re-checked against the applied tree.
- **Eight mutations, eight caught**: `export_formats` unsorted; default format
  changed; case-sensitive dispatch; the JSON non-string-key guard removed;
  `[index]` dropped from a list-element error path; INI sections no longer
  blank-line separated; the dotenv single-quote fallback removed; the top-level
  re-export dropped.

### Instruction rewritten (298 -> 294 words)

ciChecks also warned that three test titles appeared nearly verbatim as
instruction sentences. Rewriting for that was the chance to apply the
config-query lesson *before* calibration rather than after it: every
representation the tests pin is now stated, because each one was a coin flip.

- the per-format function names `export_json`, `export_dotenv`, `export_ini`,
  which the tests import but the instruction never named;
- `export_config(data, format="json", **options)` — that json is the default,
  that `format` is positional, that the rest is forwarded;
- `export_formats()` returns the names **as a sorted list** — and the prose
  listed them in a different order than the tests demand;
- mappings with **string keys** only, and non-mappings refused;
- the error path notation for list elements, `hosts[1]`;
- INI sections **one blank line apart**.

Closest test-title-to-sentence similarity is now 0.48, and that pair is
coincidental character overlap, not a restated title.

One test changed: `test_top_level_re_exports` asserted membership in
`configlayer.__all__`, the pin that failed four quality criteria at once on an
earlier task. It now checks identity against the package
(`configlayer.export_config is export.export_config`) — mutation-confirmed to
still catch a missing re-export. `test.patch` regenerated from a real git repo
and diffed against the shipped one: the only change is that hunk.

Floors: solution 486/9, tests 644/5, instruction 294 words, f2p 64, p2p 1386,
bundle 207648 bytes. Pushed; all 11 stored files pulled back and compared byte
for byte. Awaiting submit.
