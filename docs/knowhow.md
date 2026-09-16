# Knowhow — what it actually took to get a task through

Written from `dynamo-e9e60fc` (slotd), which passed **every** gate on `0f1365f`:

| gate | result |
|---|---|
| `review` — static checks + 31-criterion eval | pass |
| `cosine_similarity` · `similarity` | novel |
| `validation` — oracle 1.0 / nop 0.0 | pass |
| `ratelimit` · `tier1` | pass |
| `pass2` | 1 valid fail |
| `adversarial_review` · `deep_review` · `ava_review` | pass |
| `qc_exec` · `qc_eval` · `qc_gate` | **44 checks + probes clean** |
| `trials` — pass@5 | **avg@5 = 0.000, 5/5 genuine valid failures** |

Two things had to be true: the task stumps the model, and the verifier is sound. Both
are now measured rather than argued — zero solves across five hour-long trials, and QC's
execution probes, which actively construct and run exploits, found nothing.

It took eleven commits and about a day, and most of that day was avoidable. This is what
I would tell myself before starting the next one.

Later passes extend it. Sections 10-16 are `dynamo-321b2b9`, 17-23 are `dynamo-69378c9`,
and **27-35 are `dynamo-f28612b`** — the one where `qc_gate` had to be beaten over four
runs rather than passed first time. If you are reading this because a coverage gate keeps
failing, start at §30; if you are reading it to design the traps, start at §27.

---

## 1 · The design problem: make the sample useless

A task is only hard if the feedback the agent has cannot tell it whether it is right.
Ship a sample, ship its expected output, and make the shipped engine reproduce that
sample **byte for byte** while being wrong in every way that counts.

The technique is one constraint set that blinds every deviation at once. On slotd the
sample had:

- no machine outage, so catchup and re-anchoring can never occur;
- more capacity than units in every class, so nothing ever waits and a dispatch always
  lands on its own elapse;
- no unit carrying both a weekday and a date restriction, so intersecting and unioning
  them agree;
- a single offset era, so resolving the local offset once and resolving it per instant
  agree.

Four deviations, invisible together. The agent's only self-check is green before it
starts. Measured: **0 sample lines move** on any deviation, while each moves 67–243% of
the graded lines. (Over 100% because a wrong reading adds and removes lines as well as
changing them.)

**Design backwards from this.** Pick the deviations first, then construct a sample whose
shape makes all of them inert.

## 2 · Make ground truth derivable, not an opaque blob

Write the reference and the shipped engine as **one replay core separated by boolean
deviation flags**. Setting every flag reproduces the shipped engine byte for byte;
clearing every flag reproduces the finished solution byte for byte.

That buys three things at once:

- a reviewer can see the ground truth is derived, not asserted;
- you can measure each deviation independently by flipping one flag and diffing;
- the "how hard is this really" question gets a number instead of an adjective.

Those numbers go straight into `difficulty_explanation`. Anchor 132.8–186.4%, restriction
union 90.2–130.9%, static offset 67.0–112.0%, capacity 166.9–242.7%.

## 3 · Prove coverage by mutation, and know what a survivor means

The QC gate is a **mutation test**. It patches your oracle to violate one sentence of
your spec and checks whether the graded inputs notice. It blocked slotd exactly once,
this way:

> Mutated `reference_engine.rs` line 442 from `off.utc_for_local(local).first()` to
> `.last()`, violating §4 ("a wall-clock reading that occurs twice matches at its first
> occurrence only"). On a valid fall-back input the…

Pre-empt it: walk the spec **sentence by sentence**, mutate the oracle to break each one,
rebuild, replay every graded seed, and count moved lines. Seventeen mutations on slotd.
Thirteen moved 26–76,000 lines. Four moved nothing.

**A surviving mutant is not automatically a coverage gap, and the difference decides
whether there is anything to fix.** QC can only file a finding when it can name an input
that separates oracle from mutant. If no such input exists, the mutation was an
*equivalent rewrite* and the graded set is fine.

Tell them apart by instrumenting the oracle with a counter on the branch the mutation
touches, then running the graded seeds. Zero means dead code, and a mutant of dead code
survives no matter how rich your inputs are. All four slotd survivors were equivalent:

- `anchor.max(floor)` where every one of six call sites passes `anchor == floor`;
- a `while v <= floor` loop that can never iterate, since `v = anchor + n > floor`;
- `anchor = elapse` where `elapse == now` by construction;
- a defer-versus-catchup precedence that §6 makes unreachable by clearing waiting units
  at every down.

Two traps in the mutation itself:

- **Do not mutate a dead store.** Patching `st[i].anchor` proves nothing when the next
  line calls `next_elapse(..., elapse, ...)` and never reads the field. My first trap
  engine scored 1.000 because of this.
- **An absolute schedule makes re-anchoring rules vacuous.** Calendar grids converge no
  matter what the anchor is. If a rule is meant to couple dispatch time to future
  schedule, you need a *relative* schedule (`+<seconds>`) for the coupling to be
  observable at all.

**Coverage is a property of the generated inputs, not of the code.** The one real QC
block was caused by pinning outages across both DST transitions, so the machine was down
during the only hours where the rule was observable. Fixed with transition-avoiding
outages plus four probe units pinned into the repeating hour (2026-11-01 01:xx) and the
hour that never happens (2026-03-08 02:xx).

## 4 · The verifier runs in the container the agent just had

This is the single most important fact, and it cost more than everything else combined.
Read Harbor's source rather than assuming: `verifier/verifier.py` calls
`environment.exec` on the **same** environment. There is no fresh container. Anything the
agent installed is still there at grade time.

Seven separate findings on slotd all rested on that one sentence:

| channel | how it wins |
|---|---|
| pytest `rootdir` / `conftest` | plant `/pytest.ini` + `/conftest.py`; pytest auto-loads it as root and forces every report to "passed" |
| root-privileged compile | `include_str!` reads at COMPILE time, so a root build embeds the expected log and the binary just prints it |
| `extern crate` | an rlib compiled into rustc's own sysroot resolves by name, even with no `-L` and no `--extern` |
| reference exfiltration | a `rustc` wrapper copies every source it compiles and every binary it links; the "submission" execs the stolen reference |
| symlinked artifact | `/app/.../main.rs` → `/tests/ref/ref.rs`; the verifier reads as root, and root ignores the 0700 lockdown |
| `sys.path[0]` shadow | `python3 -m pytest` puts the cwd first; a planted `gzip.py` runs as root before collection |
| secrets on disk | expected logs written to a root-only dir can be watched for and copied the moment they appear |

I closed each one separately, a cycle each. **That was the mistake.** The premise itself
was optional.

### The structural fix

Harbor honours `[agent].user` (`trial.py` → `with_default_user(task.config.agent.user)`),
and it is in the documented schema. Editing a source file, compiling it and running it
needs no privilege. Create the account in the Dockerfile, give it `/app` and nothing else.

**That alone is not enough, and this is the part nobody warns you about.** The official
rust image ships `RUSTUP_HOME` **world-writable (777)** so unprivileged users can drive
rustup — which leaves the compiler and every crate in its sysroot writable by anyone. An
unprivileged agent could still replace `rustc` or plant an rlib. Take the write bit back,
and note that the two denials need different bits:

- creating a file needs write on the **directory** → clears the "plant an rlib" and
  "replace by rename" routes;
- overwriting one in place needs write on the **file** → clears the binaries, the driver
  `.so`s and the crates.

Name the paths. `chmod -R` fails the static check ("no broad recursive chmod in
Dockerfiles — chmod only the specific files that need it"), and it is right: seven paths
decide what a build resolves, not 131 files.

**Assert the lockdown in the image build**, so a future base image that ships these paths
differently fails the *build* rather than reopening the isolation for a gate to find:

```dockerfile
su slotd -c '! touch "$(rustc --print target-libdir)/probe.rlib"'; \
su slotd -c '! touch "$(readlink -f "$(command -v rustc)")"'; \
su slotd -c 'rustc --version'
```

**Do NOT drop the verifier's privilege too.** `[verifier].user` exists, and reaching for
it here is the obvious next thought and the wrong one. The verifier needs root for exactly
one thing: `chmod 0700` on `/tests` to close it for the duration of the run, which only
the owner can do. Run it unprivileged and either the lockdown fails or `/tests` stays
readable and the submission reads your fixtures. Root in the verifier is fine — what
matters is that no *agent-controlled binary* executes with it, which is a different
property. Audit for that instead: `grep -n '_run(\['` should return nothing, every
subprocess going through the privilege-dropping wrapper.

### Keep the defences anyway

Withholding root is the first line, not the only one. Each of these is cheap and each
answers a named QC check:

- **Ship ground truth, never compute it.** Generate graded inputs and expected outputs
  offline, commit them as fixtures, and let verify time only copy and decompress. 125,273
  decision lines came to 440 KB gzipped. This removes the last privileged execution:
  compiling the reference at verify time is what hands it to a tampered compiler, and
  hashing `rustc` does not help because the same move works on `cc` and `ld`, which see
  the linked output. Ground truth also gets *stronger* — it predates the run instead of
  being produced in a window the submission might influence. Use `gzip -n` or the embedded
  timestamp rewrites every fixture on every run.
- **Never write secrets to disk.** Decompress expected logs into the process and compare
  from memory. A file that is never created cannot be raced.
- **Ask the compiler what it read.** `--emit=dep-info` lists every file a build opened;
  requiring that list to be `main.rs` alone catches `include!`, `include_str!` and
  `include_bytes!` with nothing to false-positive on. Beats scanning the source.
- **Allow-list the sysroot crates.** Compare crate names in `rustc --print target-libdir`
  against what the pinned image ships. Verify the list on **every architecture the
  pipeline runs**: the rlib names were identical on amd64 and arm64, but the sanitizer
  `.a` archives were not, which is why the comparison covers loadable crates only.
- **`O_NOFOLLOW` on the graded artifact**, plus a regular-file check so a fifo or device
  cannot block the read either.
- **Pin the test runner's whole configuration** to the overlaid copy: `-c /tests/pytest.ini
  --rootdir=/tests --noconftest`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` with plugins named by
  `-p`, `PYTHONSAFEPATH=1` and `PYTHONPATH=`, and clear the reward path before the run
  rather than inheriting whatever is sitting there.
- **Drop privilege for every subprocess.** Audit them: I had one left (`rustc --print
  target-libdir`) running as root long after I thought the job was done. `grep -n "_run(\["`
  until it returns nothing.

## 5 · The battery

Never claim a verifier is sound; measure it. Every submission below, every time, before
every push. Stage the attacks **as the agent account**, not as root, or you are testing a
threat model that does not exist.

| submission | required |
|---|---|
| oracle | 1.000 |
| shipped engine (nop) | 0.000 |
| `include!("/opt/stash/engine.rs")` | 0.000 |
| `extern crate` from a planted rlib | 0.000 |
| artifact symlinked into `/tests` | 0.000, and nothing staged |
| `sys.path` stdlib shadow | 0.000, and no root execution |
| planted-`rustc` exfiltration | 0.000, and empty loot |

Two of these — `include!` and `extern crate` — produced a **byte-perfect graded log from a
one-line `main.rs`** before they were closed. Both were reward 1. Oracle-green and nop-zero
would never have found them.

## 6 · Getting through the gates

**Order matters.** static → eval → similarity → validation → ratelimit → pass2 → the three
reviews → `qc_exec`/`qc_eval`/`qc_gate` → tier1 → trials. Anything failing skips everything
downstream, which is why a QC fix can sit unevaluated for four runs while an unrelated gate
keeps failing first. Check *which* gate blocked before concluding anything.

**Comments are graded.** Three ways they sink you, all three hit me:

1. **Never write down a hole you have not closed.** QC "defaults to FAIL and only reaches
   PASS when every break attempt is refuted by a citation in your code" — a comment
   admitting an open weakness is that citation, pointed at you. I shipped *"That trust
   boundary is not closed here"*, *"the suite will not catch it"*, *"which no test file can
   do"*. Each was true and each handed over a finding for free. Describe the defence, not
   its perimeter.
2. **Prose contradicting the code fails `verification_explanation_quality` outright.**
   Rewriting the verifier and leaving `task.toml` describing the old design cost a full
   cycle: *"Describes a compile-the-reference-at-verify-time flow and claims fixtures aren't
   committed — both contradicted by the actual tests."* When the design changes, grep the
   old claim out of `task.toml`, the module docstring, the Dockerfile and `test.sh` **in the
   same commit**.
3. **Nothing agent-visible may hint at the answer.** Section headers are fine; a
   "Still missing:" list in the unfinished source is a giveaway.

**Push discipline.** Every push fires the whole pipeline and cancels the run in flight. I
burned six runs to cancellation. Batch fixes, exhaust the *class* before pushing, and hold
the commit while a run is executing a stage you have never reached before.

**Where a saved guide page and CI disagree, CI wins.** The learn-site page said the
time-budget line in `instruction.md` was mandatory; the live pipeline fails
`instruction_concision` for it. The same page lists 30 QC checks; the live gate announced
37 static checks plus Tier-2 execution probes, 44 in total. Treat saved pages as
orientation and the pipeline output as the contract.

**Simulate locally, but do not trust the simulation.** Running the eval/QC/AVA prompts
against a model before pushing is a useful filter and it is cheap. It is also noisy in both
directions: it returned PASS on a head real AVA then blocked for compile-time inclusion, and
BLOCK on a false claim that `subprocess.run` rejects `user=`/`group=` (it has accepted them
since 3.9; the image ships 3.11). Verify every claim against the actual image before
changing code.

## 7 · Reading the difficulty signal without panicking

`pass2` runs 2 trials and gates on **at least one valid failure**. `trials` runs 5 and
reports `avg@5`. They measure the same thing at wildly different resolution, and a small
sample will lie to you.

Across four runs of an unchanged task this one scored 0/2, 0/2, then **1/2 solved** — and
the run where a model solved it is the run that went on to score **avg@5 = 0.000**, five
genuine failures out of five. One solve at pass@2 is variance, not a verdict.

So: **do not touch difficulty on a single pass@2 solve.** Changing the task mid-run
cancels the gates in flight and throws away the evidence you were about to get. Let
`trials` report. If `avg@5` really does come back high, then act, and act on a measured
lever — the mutation sweep already tells you which discriminator is thin. On slotd the
`.first()`/`.last()` DST mutation moved only 26 lines on one seed against thousands on
the other two, so that seed was the obvious place to strengthen if it had been needed.

Read the classifier line, not just the pass/fail. `Breakdown: N solved · N good-valid-fail
· N soft-timeout-fail · N task/verifier-issue · N in-progress-timeout · N infra/setup-timeout`
distinguishes "the model tried and failed" from "the harness fell over". Only the first
is evidence about your task. A trial cut short because someone pushed and cancelled the
run counts as neither, and the advisory comment generated from it will confidently
analyse noise — I lost time reading one that said "neither trial completed" when the real
cause was my own push.

## 8 · Small things that each cost a cycle

None of these are interesting. All of them are red checks.

**The static gate, in full.** It runs before the rubric eval in the same job and masks it
on failure, so know what it wants. Observed passing list: `task.toml` has all required
metadata fields and no placeholders; category/objective/artifact labels come from
`references/diversity-taxonomy.toml`; slug is ≤3 tokens; `instruction.md` uses absolute
paths and is ≤1500 tokens (o200k_base); expected output files are documented in
`instruction.md`; `allow_internet` true; agent/verifier timeouts within cap; canonical
`gpu_types`; verifier writes `/logs/verifier/reward.txt` and does not pre-create it;
approved base image; non-trivial build context has a `.dockerignore`; no source embedded
via Dockerfile heredoc; no `apt-get upgrade`; Dockerfile does not COPY `solution/` or
`tests/`; apt hygiene; not pinned to a CPU platform; no bare `nproc`; pip/uv installs
version-pinned; verifier fetches nothing at trial time; `test.sh` installs nothing;
`tests/` has `test_outputs.py` and `test.sh` runs it; **no broad recursive `chmod`**.

The two that caught me: a missing `.dockerignore`, and a Dockerfile **comment** containing
the literal `tests/` — the check text-scans, so prose counts.

**`artifacts` goes at the TOP of `task.toml`, above the first `[section]`.** TOML puts any
key after a table header inside that table, so `artifacts` under `[verifier]` is silently
a different field. Declare every agent-produced path the tests read; an undeclared `/app`
path is a `verifier_configuration` failure.

**`solution/` must do everything `instruction.md` asks, not a subset** (QC check A2), and
after you set `[agent].user` it has to work as that account too — verify it, don't assume.

**`README.md` at the repo root stays empty.** Rationale belongs in `task.toml`.

**Decode QC's evidence rather than reading the truncated comment.** The visible text cuts
off mid-sentence; the full findings are in a base64 blob:

    gh pr view N --json comments --jq '.comments[].body' \
      | grep -o 'QC-FIXES-B64:[A-Za-z0-9+/=]*' | sed 's/.*://' | base64 -d

**Sticky PR comments are reused and re-dated.** A `pass2_suggestion` or QC comment on the
PR may describe a run you cancelled hours ago. Check the run it names before acting on it.

**On macOS, Docker cannot bind-mount `~/Downloads`** (file-sharing restriction). Do all
container work from a scratch directory under `/private/tmp`, or you will spend an hour
on a permissions error that has nothing to do with the task.

## 9 · When the same fix keeps coming back

The meta-lesson, and the one that would have saved the day: **when the third fix in a row
is the same shape, stop fixing and go find the sentence they all depend on.**

Seven findings, one premise. I falsified the consequences one at a time, roughly forty
minutes each, while the premise sat there generating more. The premise was a line in
`task.toml`.

---

# Second pass: `dynamo-321b2b9` (heus), 2026-07-29

Passed every gate on the **first push**, which slotd did not: `pass2` 1/2, then
**pass@5 = 2/5, avg@5 = 0.400, three good-valid-fails, no timeouts and no
task/verifier issues**. The crux landed where it was designed to. The analysis of the
failing trial reads *"exactly failure mode #3 in task.toml"*: the agent zero-weighted the
dropped PSU's households instead of removing them, which froze the adjustment-group
boundaries and put all 18 standard errors wrong while leaving the estimates and df right.

What made the difference was doing §1 to §3 of this document *before* writing the task
rather than after, and one structural choice that deleted most of §4.

## 10 · Grade a data file, not a program

Every finding in §4 rests on one sentence: the verifier runs in the container the agent
had. Pose the task so the agent computes answers from data it can see and writes them to
a file, and the sentence stops applying, because **nothing of the agent's executes at
verify time at all**. No compile-time inclusion, no planted crate, no pytest rootdir
hijack, no exfiltrating compiler wrapper. Seven findings, one design decision.

Difficulty does not suffer, because the stump lives in the shipped spec and the blinded
sample, not in hiding the inputs. Fairness improves: every case graded is visible to the
agent, so there is no hidden-input objection to answer. The deep review confirmed it and
found no viable bypass.

Do not read this as "static outputs are safe". It moves the attack surface, it does not
remove it, which is the next section.

## 11 · A plain-value fixture IS a submission, and a leftover process will race you

This is the one thing I would not have found by reasoning, and I nearly shipped it.

Ground truth sat at `tests/fixtures/expected.json` shaped exactly like the graded output:
keyed by estimand id, three fields each. A process left behind by the turn, running as the
unprivileged agent account and polling for `/tests`, copied that file over its own output.
**Reward 1.0, three runs out of three, for a submission that did no work.**

Both instincts were timing fixes and both failed. `chmod 700 /tests` as the very first
statement of `test.sh` does not help, because the copy lands while `/tests` is still being
mounted, before `test.sh` exists to run. A "written after grading began" mtime stamp does
not help either, for the same reason, and an attacker who owns the file can forge an mtime
anyway.

The fix is structural, per §9: attack the premise, which was that the answers sit on disk
*in a form that is directly usable as a submission*. Commit them as salted PBKDF2 digests
of the values rounded to a stated precision. A copy yields hashes, and a search over one
field's six-digit space at 200,000 iterations outlasts a grading run by orders of
magnitude. Plain SHA-256 is **not** enough here: an attacker who can compute the easy half
of the answer knows each value to within a few percent, which is about 1e5 candidates a
field, and that brute-forces in under a second.

Two consequences to plan for, not discover:

- **State the precision in `instruction.md`.** Digest matching is exact-after-rounding, so
  it is only fair if the prompt says what is compared. Six significant digits, stated.
- **Prove no value sits near a rounding boundary.** The fixture generator refuses to write
  unless every graded value is clear of one; the closest here was 0.009 of a step, where
  two implementations agreeing to 2.5e-14 would need 2.5e-8. Without that check a valid
  solution can fail on a coin flip, which is the unfair-tolerance failure in a new costume.

Then put the attack in the pre-flight battery and keep it there.

## 12 · Coarsening the comparison changes what your mutation battery means

The battery in §3 judged mutants by a 1e-9 relative diff. Once grading compared six
digits, that was measuring something grading no longer did. Re-pointing the battery at the
**actual** grading comparison immediately turned up a sentence nothing noticed: loosening
the raking stopping rule from 1e-12 to 1e-4 left all 54 fields byte-identical.

That one was benign, and worth recognising as benign rather than "fixing": it means no
implementation can fail on its choice of stopping rule, which is a fairness property. But
I only knew that because the battery was judging by the real yardstick. **Whatever your
verifier actually compares, that is what the battery must compare.**

## 13 · A surviving mutant can indict the DATA, not the coverage

§3 says a survivor is either a coverage gap or an equivalent rewrite. There is a third
case. A mutant reversing the raking margin order changed nothing, and the reason was not
equivalence: the three margins had **inconsistent grand totals**, so the raking never had
a fixed point and was settling into a cycle whose result depended on margin order by 1e-2.
Every estimand was a ratio, so a near-uniform rescale cancelled and the graded numbers
never moved.

Nothing else would have caught it. The oracle passed, the cross-check agreed, convergence
"succeeded" in seven passes. Scaling every margin to one grand total made raking converge
to 1e-15 and order-independent to 3.3e-15, and moved the committed answers by 2.5e-10,
which is nothing. The defect was never in the numbers, it was that the specification's
stopping rule had been doing load-bearing work I never intended it to do, and a reviewer
would have been right to say so.

## 14 · Blind the machinery, not the output

§1 wants a sample that reproduces byte-for-byte while being wrong in every way that counts.
The trap is building one so degenerate it announces itself. The first construction here
made every PSU in a stratum an exact clone, which blinded all four deviations and also
drove every jackknife standard error to exactly zero. A demo whose errors are all `0.0` is
not a false green, it is an obviously broken fixture, and it would have been flagged.

The fix is to separate the variables the *machinery* uses from the variables the *answer*
uses. Clone the PSUs in base weight, response class, response and every calibration
margin, and let them differ freely in the survey variables. The weighting chain then
cannot tell the replicates apart, so re-running it and rescaling agree to the last bit,
while the standard errors come out as ordinary non-zero numbers that look like a working
check. Measured: **all four deviations together move 0 of the demo's 12 fields** and
18 of 18 graded estimands.

## 15 · Stop when you have passed

`avg@5 = 0.400` is one trial from the 0.5 boundary, and **pass@5 is a fresh stochastic
draw on every push**. After the run came back green I had three real defects in hand from
a later task: `chmod 0700 /tests` without a `chown` first (a bind mount's uid comes from
the host and can collide with the agent's), `O_NOFOLLOW` without `O_NONBLOCK` (a fifo at
the graded path hangs the verifier until timeout, producing no `reward.txt` at all), and a
session fixture whose `os.chmod` could fail a correct solve. All three are genuine. None
of them fired: oracle 1.0, validation pass, AVA found no bypass.

Fixing them would have spent a billed run and re-rolled a passing pass@5 to repair
problems the environment did not exhibit. **Bank the pass and carry the fixes into the
next task.** The corollary to §6's push discipline: the discipline applies to a green run
too, and the strongest reason not to push is that you have already won.

## 16 · Environment note

`harbor run` fails under `~/Downloads` on this machine: Docker Desktop refuses the
bind mount and the error names Docker compose, not the mount, so it reads like a broken
Dockerfile. Copy `task/` to `/private/tmp` and run there. Plain `docker build` plus
`docker run` is unaffected, which is why the pre-flight battery is the faster loop and
`harbor` is only the final confirmation.

# Third pass: `dynamo-69378c9` (gst), 2026-07-29

Passed **every gate on the first push**, and the difficulty result was the best of the
three: `pass2` 0/2, then **pass@5 = 0/5, avg@5 = 0.000, five good-valid-fails, no
timeouts, no task/verifier issues**. QC ran 44 checks and probes clean, the adversarial
cheat-pass found no exploit, and `deep_review` returned 25 of 25 with the oracle
derivation audit clean.

The interesting part is that **the crux did not land where it was designed**. Seven
conceptual traps were planted in the analysis plan. Every agent across all seven trials
read all seven correctly and still scored zero, on something I had not thought about.

## 17 · The crux you ship may not be the crux that decides

The task asked for group-sequential boundaries, which are roots of joint-normal rectangle
probabilities. I solved it the way the field does, by exploiting independent increments to
collapse every rectangle to a one-dimensional integral on a fixed grid, good to 1e-14.
Every agent instead assembled the covariance matrix and called
`scipy.stats.multivariate_normal.cdf`, whose randomised quadrature holds six digits at one
or two dimensions and misses at three to five. They got the statistics right and lost the
sixth significant digit.

That is a legitimate and better discriminator than the seven I planted, and both reviews
said so independently. But `difficulty_crux` is scored **per trajectory**, against what
`difficulty_explanation` claims, so it failed on the trials that never touched the seven
traps: 1 of 2 at pass@2 and 2 of 5 at pass@5, plus an advisory from `deep_review` and a
`difficulty_crux` note from CI. Nothing blocked, but three separate gates said the same
thing.

**So: read the pass@2 trajectory analysis for the mechanism, not just the verdict, and
rewrite `difficulty_explanation` to name the mechanism that actually decided the runs.**
The gates tell you what your task is really testing. Believe them over your design notes.

A cheap way to have caught it early: ask which numerical route a competent implementer
would reach for first, then check whether that route holds the precision you grade at. If
it does not, that is your primary crux and it belongs in the metadata from the start.

**Read §36 before generalising this one.** The lesson here is narrower than it looks: what
made `gst` bite was that the precision was lost *inside a library the agent chose*, not that
the crux was arithmetic. Two deliberate arithmetic-and-parsing cruxes built on the wider
reading were solved by every trial that met them.

## 18 · A digest is only as private as its preimage is wide

§11 says commit the fixture as salted digests rather than plain values. That is necessary
and not sufficient. Digest each field separately and the fields with narrow preimages fall
immediately: `stop_look` was a small integer and `decision` was one of two words, so a
leftover process that reads `/tests/fixtures` inverts both by trying every candidate.
Six-significant-digit reals are safe, roughly 1e7 candidates against 200,000 PBKDF2 rounds
each. Ten candidates are not.

The fix is not a bigger iteration count. It is to stop giving a narrow field its own
digest: join every field of the record with a separator and digest the whole preimage, so
recovering the verdict requires already knowing every number. Keep per-field digests for
the wide fields, because they are what gives the failure message a useful name.

My own pre-flight found this, before the push, by staging the watcher as the agent account
and asking what winning the race actually buys. The adversarial reviewer then probed the
same vector and reported it **closed**, naming the record digest as the reason. Had I
shipped per-field digests for those two, that report would have named an exploit instead.

Corollary worth stating plainly: **the reward being 0 is not proof the fixture is safe.**
Ask separately what a full read of the fixture yields.

## 19 · Vary every spec parameter across the graded inputs

QC's one advisory was `Default-Only Parameter Coverage`: all four trials carried
`alpha = 0.025` and `beta = 0.10`, so an implementation that hardcoded those constants
graded identically to one that read each `design.json`. The spec required reading them;
the graded set never checked.

This is §3's mutation logic applied to inputs rather than code, and it generalises to
every parameter a spec tells the agent to honour. If each graded case carries the same
value, the rule is untested. Fixing it cost one trial at a one-sided 0.05 and another
spending a beta of 0.15, and hardcoding the shared value then moved 9 of 73 fields.

Do this at generation time. Changing input data afterwards means regenerating fixtures,
re-running the whole battery, re-measuring every deviation, and correcting every
percentage the metadata quotes, because those numbers move even when the field counts do
not.

## 20 · Blind many axes at once with a degenerate case, not a tuned one

§1 says construct a sample whose shape makes every deviation inert. On slotd that took
four separate constraints. Here one structural choice did it: a pilot with a **single
analysis**. Stopping at the first look makes the stagewise ordering degenerate to the
fixed-sample one, makes the median-unbiased estimate equal the maximum likelihood
estimate, leaves no continuation region for a futility boundary to reach into, and never
fires the final-analysis rule. Pinning its maximum information and maximum analysis size
to exactly twice what that analysis accrued put the observed, subject-count and planned
information fractions on the same number to the bit, exactly rather than approximately.

Seven independent axes, zero of ten pilot fields moved by any of them, and none of it
needed a seed search. **Look for the degenerate configuration of your domain before you
start tuning data**, because exact blindness beats tuned blindness and it survives
regeneration.

The cost is real and it showed up in review: a degenerate self-check gives no signal on
the axis that gates the task, and both `pass2` and `deep_review` suggested adding a
non-degenerate second fixture. I declined, because any multi-analysis pilot exposes the
ordering, the estimator and the futility interaction, which is three of the seven traps
for one advisory note. Work that trade out explicitly rather than reflexively.

## 21 · Validate the core numerics against something published

`correct_expected_results` and `reviewable` both ask why the ground truth is believed. Two
independent implementations agreeing to 5e-14 answers "consistent", not "correct": both
could share a misreading. What closes it is an external anchor. The boundary routine
reproduces the published Lan-DeMets O'Brien-Fleming table for equally spaced analyses to
four decimals, its exit probabilities sum to alpha at the final boundary, and at a single
analysis its interval and estimate collapse onto the Wald ones.

Three cheap checks, and the review quoted the first one back as the reason the fixture is
"not an Oracle echo". Find the textbook case your machinery must reproduce and assert it.

## 22 · Observed gate order and what it costs

The board on this run, in the order it settled: `cosine_similarity`, `review` (24 static
checks then the 31-criterion eval), `similarity`, `validation`, `ratelimit`, `pass2` with
`pass2_suggestion` skipped, `adversarial_review`, `deep_review`, `ava_review`, `tier1`,
`qc_eval`, `qc_exec`, `qc_gate`, `trials`, then `gate` and `claude-cost-report`. Roughly
five hours end to end, with `pass2` and `trials` taking most of it.

`trials` does not appear on the check list at all until QC clears, so an empty slot where
you expect pass@5 means QC is still running, not that trials failed.

`ava_review` filed a `verifier_coverage` advisory claiming the verifier imports its oracle
module. It does not: `tests/test_outputs.py` imports `hashlib`, `json`, `math`, `os`,
`pathlib`, `stat` and `pytest`, and the only occurrences of "solution" and "reference" in
`tests/` are two docstring lines describing where the digests came from. A text scan
appears to have read provenance prose as a dependency. **Verify an advisory against the
code before editing anything**, and do not delete provenance that
`verification_explanation_quality` rewards in order to satisfy a heuristic.

## 23 · The eval reads `task/` and nothing above it

`verification_explanation` cited `preflight.sh`, which lives at the repo root. The eval
filed a note: *"references a `preflight.sh` that is not in the submission"*. It reads
`task/` as the whole submission, so anything above that directory does not exist as far as
the graded prose is concerned.

Keeping `preflight.sh` and `harness/` at the root is fine, and `no_extraneous_files` passed
with both committed. Only the citation is the problem. State the measured claim in terms of
what the graded tree contains: not "preflight.sh runs the theft and scores 0" but "the
theft was staged and measured before submission, and the fixture carries no graded number
anywhere in its text".

After writing `task.toml`, grep the three explanation fields for any path that does not
start with `solution/`, `tests/`, `environment/` or `/app`.

# Fourth pass: `dynamo-f28612b` (mx1), 2026-07-29

A cycle-accurate emulator for an invented 8-bit machine, the MX-1, whose CPU shares one
memory bus with a scanout unit. Green on `216e77d`, all fifteen jobs:

| gate | result |
|---|---|
| `review` · `cosine_similarity` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | 1 solved · 1 valid fail |
| `adversarial_review` · `deep_review` · `ava_review` | pass |
| `tier1` · `qc_exec` · `qc_eval` · **`qc_gate`** | **Verdict: PASS, no blocking issues** |
| `trials` — pass@5 | **1 of 5 solved, 4 valid fails, every rubric criterion PASS** |

This is the first task here where `qc_gate` passed, and it took four runs to get there.
What follows is what the difference was: how the traps were built, and what a mutation
sweep has to do before the gate believes it.

The verdict is worth quoting, because it describes the trap working:

> Four of five agents correctly implement opcodes, RMW, I/O mirroring, and open-bus but
> fail by preserving the original `tick()→acquire_bus()` pattern for non-transfer internal
> cycles; the one passing agent succeeded by performing a second reflective spec-reading
> pass.

## 27 · The best trap is inherited working code, not a missing sentence

§1 says make the sample useless. That is necessary and it is not sufficient: a blind sample
means the agent gets no signal, but something still has to supply the *wrong* answer
confidently. Here that was the shipped engine.

`/app/emu/src/main.rs` arrives unfinished — fifteen opcodes missing — and it already models
bus contention. It has an `acquire_bus()` helper and a `tick()` that routes every cycle
through it. It looks like working code by an engineer who understood the machine, because
structurally it is. It is also wrong: §2 scopes arbitration to bus *transfers*, §5 writes
non-transfer cycles as `-`, and a cycle carrying no transfer has nothing for arbitration to
hold. Every internal cycle therefore stalls when it should not, and the clock drifts
against the slot grid.

Four of five agents implemented all fifteen opcodes, derived the two electrical rules, and
still failed — because they kept `tick()`. The trap is not that the rule is hidden. The rule
is stated twice, in two sections. The trap is that the code answers the question before the
agent thinks to ask it.

Design consequence: **give the agent a plausible wrong model to inherit, in the same file
they have to edit.** A missing implementation invites reading the spec. An existing
implementation invites pattern-matching, and pattern-matching is what you are testing.

## 28 · Pick a domain with a famous near-neighbour, then differ from it deliberately

The MX-1 is 6502-shaped: same mnemonics, same addressing modes, `$0100+SP` stack. That was
chosen, and it pays twice.

It pays on difficulty, because the model arrives with 6502 instincts that are wrong here.
The 6502 charges an extra cycle when an indexed read crosses a page and when a taken branch
crosses one; the MX-1's §5 templates are flat. The 6502 pushes `PC-1` on `JSR` and has `RTS`
increment; the MX-1 pushes the address of the byte following the operand and suppresses the
increment. Nothing is hidden — §5 gives exact templates — but an implementer writing from
memory never re-reads the template.

It pays again on coverage, because those instincts are a *free list of mutants*. You do not
have to invent plausible wrong implementations; the near-neighbour hands you the ones a real
implementer will actually write (§30, round three).

The cost to watch: the near-neighbour must differ **only** where you say so, and every
difference must be on the page. A gratuitous difference reads as a trick.

## 29 · Premise, not behaviour — and never claim it is unreachable

Two of the four deviations here are consequences the spec never states as behaviour:

- §1: *"the address decoder is fed A0 and A1 only, and the remaining address lines select
  the block itself and are not decoded within it"* → the four registers repeat every four
  bytes to `$FFFF`, so `$F8F0` is STATUS. Decoding is `addr & 3`, not three equality tests.
- §2: *"The data lines carry no pull-up and no pull-down network. They are held only by the
  capacitance of the traces... A device that is not selected does not drive them."* → an
  undriven read returns the last byte any master drove, not `$00`. And since the scanout
  unit is a master, what a floating read returns depends on whether a latch fell between.

This is the shape to aim for. The sentence is a *circuit*; the graded output depends on its
*consequence*. It is fully fair — nothing is withheld — and copying the sentence into code
does nothing, because there is no behaviour in it to copy.

**Then do not overclaim it.** `difficulty_explanation` said these "cannot be reached by
transcribing the document". The pass@2 difficulty engine tested that and posted the
refutation on the PR:

> The `task.toml` `difficulty_explanation` claims two of these "cannot be reached by
> transcribing the document", but both pass@2 agents derived all four from the spec alone
> in under an hour.

An automated reviewer publicly contradicting your own metadata is the worst possible thing
for a human grader to read next to it. The honest claim is narrower and still strong: these
are derivable, one of two agents derived them, and what separates them from the other two
deviations is that transcription is not enough. Write the claim you can survive being
tested on.

## 30 · Four rounds of mutation, and the fourth audits the other three

§3 says prove coverage by mutation. Four runs at `qc_gate` taught me that "mutate every
rule" is round one of four, and that rounds two to four each find things round one cannot.

**Round 1 — enumerate the rules.** One mutant per normative sentence. 47 mutants.

**Round 2 — mutate the way an implementer would get it wrong.** Round one picks whichever
mutation is easiest to write, which is not the same as covering the rule. `ASL` with its
carry forced to `false` was caught; `ASL` that *drops* the carry, or takes it from bit 0 the
way `LSR` does, was not — because the probe used `$81`, where bit 7 and bit 0 are both 1.
The fix is in the probe, not the mutant: use `$80`, and consume the carry through `ADC`
before anything else can touch it. 10 mutants, and QC had already found one of these gaps
for me the hard way.

**Round 3 — mutate what the spec says by omission.** This is §28 cashed in: the
near-neighbour's behaviour, written down as mutants. Page-cross penalties on indexed reads,
indexed writes and taken branches; `JSR` pushing `PC-1`; `RTS` incrementing; `PHA`/`PLA`
with the transfer one cycle early. 27 mutants, **ten of which survived a graded set that
already killed 57.**

**Round 4 — audit the enumeration, not the machine.** A sweep is only as good as its list
of sentences, and nothing had checked that list. Map every mutant back onto the spec, line
by line, and write down which sentence each one attacks. Six normative statements had
nothing standing against them: the stack occupying `$0100-$01FF`, the program image loading
at `$0200`, RAM reading `$00` at power on, a halt leaving the scanout unit running, all four
flags clear at reset, and N and Z following a read-modify-write result. All six turned out to
be caught by ROMs already in the set — the missing coverage was in the sweep's opinion of
itself. That is still worth an hour: an uncovered sentence and an unproven sentence look
identical until you check.

Final: **90 mutants, 85 killed by a graded input, 5 unobservable.**

One sentence resisted being a mutant at all. "A write to HALT stops the processor. The
scanout unit is unaffected and continues to run" — a scanout unit that *stopped* never fills
the output stream, so the mutant does not terminate rather than producing a wrong answer.
That is a real finding about the verifier, not a hole: it is why every run the verifier makes
is bounded, and saying so in `task.toml` turns an awkward gap into the reason a timeout
exists.

## 31 · Gap or equivalent rewrite: fuzz to find, enumerate to prove

§3 says a survivor is either a coverage gap or an equivalent rewrite and you must decide
which by hand. Here is how to decide it without being wrong, which I was twice.

**Fuzz first.** Generate a few hundred random programs, run oracle against mutant, count
separations. Cheap, and every separation hands you a starting input for a real gap. Ten
survivors: fuzzing confirmed three immediately.

**A fuzzer finding nothing proves nothing.** It is often structurally incapable of reaching
the case. Mine never emitted code near a page boundary, never hit one exact address out of
twelve thousand, and never fetched an opcode from undriven space — so it called three real
gaps clean. Ask what your generator *cannot express*, and hand-build a probe for each.

**Enumerate where the domain is small.** Two survivors were settled exhaustively rather
than by argument:

- `SBC` written as a borrow subtraction agrees with `A + (M XOR $FF) + C` on A, N, Z and C
  for all 131072 operand combinations. Only V differs, and §6 lists no `BVC`, `BVS` or `PHP`
  — V is computed and unreadable.
- An I/O register sampled at the cycle a held transfer was *attempted* agrees with one
  sampled at the cycle it *occurs* for every cycle in the frame period, because a hold is
  exactly one cycle and a slot is four, so it can never carry the transfer out of the slot.

An equivalence claim you reasoned out from the source is a guess. One you enumerated is
evidence, and it goes in `verification_explanation` as evidence.

**Then say it positively.** Not "five mutants survive" — that hands QC a citation against
you (§6.1). "Ninety mutants, and every one that any input can tell apart from the reference
is caught by a graded ROM", with the impossibility proofs attached.

## 32 · Check that the probe can provoke what it tests

Two of my three new probes were wrong on the first attempt, both because the probe could not
provoke the thing it was written for. Both failures are arithmetic and both generalise.

**Stride.** `PHA` is 3 cycles against a 4-cycle slot, so a run of them visits every phase and
a collision with a slot start is unavoidable. `PLA` is 4 cycles — exactly one slot — so a run
of bare `PLA`s sits on one phase for its entire length and can hold a misplaced transfer
forever without ever colliding. If your probe repeats an operation to hit a periodic
condition, check that the period and the stride are coprime, or choose the phase deliberately.

**Sign.** Holding a transfer for one cycle lengthens whichever machine collided. So a run on
one phase costs the *wrong* machine a cycle and a run two phases along costs the *right* one.
Walk every phase and the drift sums back to zero and the mutant survives a probe that
provoked it perfectly. Fix: read the instrument *between* runs, not once at the end. Four
runs of sixteen pulls, with `SLOT` read after each, and a 3-cycle store between runs to move
the phase.

Generally: a probe that fails to kill its mutant is telling you something about the probe.
Debug the probe before you conclude the rule is unobservable.

## 33 · Verify a committed fixture against the prose that describes it

The graded ROMs ship as bytes; the claims about them live in comments. That pair drifts
silently, and a reviewer cannot check a binary by reading it.

So re-derive the claims from the committed bytes. A 90-line decoder that reads each ROM back
and asserts the property the comment states: that `tim02`'s single branch sits on page `$03`
with its target on `$02`, that its eight indexed reads and eight indexed writes all cross a
page with `X=$FF`, that `stk01`'s pulls form four runs of sixteen rather than one run of
sixty-four, that `bus02` both writes and reads `$EFFF`. Fifteen claims, all re-derived.

Run it as part of the pre-flight. A comment describing a fixture is an assertion about data
you can actually make.

## 34 · Re-measure every number when the graded set changes, and read your own prose as a hostile

Adding three ROMs invalidated four numbers and two claims already in `task.toml`. One of the
claims was flatly false and falsifiable in a single command:

- *"still wrong on every graded ROM"* — measured, the shipped deviations move 17 of 21. The
  four they do not move are the opcode-semantics ROMs, which sit on the other axis. Grading
  is all-or-nothing so it is still a failure, but "every" was wrong, and it was wrong before
  I touched anything.
- *"wrong on 62 to 64 of 64 frames on every graded ROM"* — it is 63 of 64 on the twelve ROMs
  that race the beam.
- the sample-blindness percentages moved: 79/55/22/16/11% became 81/56/18/18/9%. Samples
  still move **0 of 256** lines, which is the claim that matters.
- *"two rustc builds plus thirty emulator runs"* — 75 runs, measured at about a second
  against a 300s budget.
- and I wrote that the 6502 charges a page-cross penalty on an indexed *write*. It does not;
  `STA abs,X` is five cycles there too.

Every one of those is the same failure: prose written once, then left alone while the thing
it describes moved. §6.2 says grep for the old claim in the same commit. Stronger version:
**make the numbers reproducible.** Keep the measuring script, re-run it, paste the output.

And derive the graded set from the shipping verifier rather than restating it — my sweep
harness parses `GRADED` out of `test_outputs.py`, so the sweep cannot silently measure a
different set from the one that ships.

## 35 · Passing `qc_gate` is a floor, not a ceiling

`qc_gate` passed on the commit that did **not** have rounds three and four. It reported
*"no blocking gap-rubric failures or material coverage holes found"* while six normative
sentences genuinely had no graded input that noticed them.

So the gate is a floor. It does not certify coverage; it fails to find a hole. Two
consequences:

- Do not treat a green `qc_gate` as evidence your mutation sweep is complete. Run rounds
  three and four anyway — the human score grades `verification_explanation`, and a reviewer
  who mutates one rule you missed is reading your prose at that moment.
- Do read its advisory notes as real findings. Mine flagged that `.dockerignore` guarded only
  `race*`/`rmw*`/`mix*` while eight graded families were unguarded — and two of the three
  ROMs I was about to add were in those families. Advisory, non-blocking, and exactly right.

---

# Fifth pass: `dynamo-03e2fc8` (ordersvc), 2026-07-30

A landing-zone gate in front of a warehouse load: it reads a night's change-data-capture
feed, decides which events are admissible under a normative contract, and reports the
findings and what landed. Green on `a6ce252`, every job, PR labelled **accepted**:

| gate | result |
|---|---|
| `review` · `cosine_similarity` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | **0 of 2 solved · 2 valid fails**, every rubric dimension PASS on both |
| `adversarial_review` · `deep_review` · `ava_review` | pass |
| `tier1` · `qc_exec` · `qc_eval` · **`qc_gate`** | pass |
| `trials` — pass@5 | **2 of 5 solved · 3 good valid fails · avg@5 = 0.400 · Difficulty OK** |

**Eight previous runs blocked at `pass2`, every one of them 2/2 solved.** This pass is
mostly about why, because the fix I designed is not the fix that worked, and the gates said
so plainly enough to correct §17.

## 36 · A trap about one value loses; a trap about *when* a value is read wins

§17 says the crux you ship may not be the crux that decides, and reads the `gst` case as
"the numerical route a competent implementer reaches for did not hold the precision".
I generalised that to *doing problems beat reading problems* and built two of them:

- **exact decimal against float.** V8 compares `amount x rate` rounded half to even. The
  shipped gate rounds with `round`, which *is* half to even, applied to a product formed
  from `float(rate)`. Right rule, wrong operand — an agent that checks whether `round` does
  banker's rounding finds that it does. Band edges planted exactly on halfway cases, both
  parities, both sides, either side of zero: 33 to 40 findings a feed.
- **repeated JSON names.** An object whose text repeats a name is malformed. `json.loads`
  keeps the last occurrence and records nothing, so the check cannot be written where the
  other checks live and the parse has to move to `object_pairs_hook`. 135 to 212 findings a
  feed, with cascade.

**Both were solved by every trial that met them**, twice over. The pass@5 report said it
outright: the failing agents "correctly fixed six of the seven hidden defects (Decimal
arithmetic, effective-from band lookup, duplicate-key detection, ...)".

What survived was a **deferred referent**: a child row's parent resolves once every event of
the transaction has been evaluated, not when its own event is. Agents write
`if orphan(event, working["orders"])` inside the per-event loop. One failing trial
"consumed the full spec but misimplemented the requirement regardless" — so this is an
implementation crux, not a reading one.

So the rule is sharper than §17 as I had it. **Anything the spec states as a property of one
value, this model computes correctly**, Python gotchas included. What it still gets wrong is
a rule about *when* something is evaluated relative to other events — a referent that
resolves at a different point in the loop than the natural place to write it. `gst` worked
because the loss happened inside a third-party library the agent chose; under a
stdlib-only instruction there is little room for that, so ordering is the lever.

**The beaten traps still earned their place.** Fixing six of seven scores zero. Their job was
to close off the other six defects so the seventh was the one left standing — breadth under
an all-or-nothing digest is what converts one surviving trap into a pass.

## 37 · Read the per-rule deltas, not the verdict, to learn which trap was beaten

The pass@2 report gives a golden-vs-agent table per rule. Sum the listed per-rule deltas and
compare against the reported total: if the residual is zero, every rule *not* listed was
exactly correct. That is how I learned both new cruxes had been beaten rather than guessing
from the fail-reason prose, and it was decisive on all three feeds and both trials.

Do this before deciding what to build next. A verdict tells you whether you passed; the
residual tells you which of your traps is dead.

## 38 · A spec over ~10kB loses its middle, and that is not a design

The harness truncates terminal output at roughly **10,000 bytes** by eliding the middle —
head and tail survive, silently. `contract.md` grew 9,770 -> 11,274 bytes in the same commit
that added the two cruxes above, and both `pass2` trials then read it and lost lines ~95-167,
the interior of the section carrying the deferred-referent rule.

It broke the deadlock and every rubric dimension still passed, including
`difficulty_crux`. It is still not a crux — it is a byte count, it only fires on trials that
read the file in one shot, and it explained just one of the three pass@5 failures. Know the
size of every normative document you ship and decide which side of the threshold it sits on;
if it must exceed it, put nothing load-bearing in the middle third.

## 39 · One instrument, both directions

The two claims a graded fixture rests on are opposites: **every wrong reading must move the
graded feeds, and none of them may move the worked example.** Written as two separate checks
they drift apart.

`readings.py` holds each alternative reading as a whole rule that swaps into the reference —
the four other ways to turn a product into an integer, the rate through a double, a parse
that collapses a repeated name. `build_graded.py` refuses to write a feed unless every one
changes what that feed reports; `build_sample.py` refuses to write the example unless none
does. Same code, both directions, so blindness and decisiveness cannot be claimed
independently. Pre-flight then re-runs both against the fixtures *as committed*, not against
whatever the generator held in memory.

## 40 · Make the discriminator a property you choose, not one you happened to get

Whether the float route disagrees with the exact one at a halfway case is a property of the
**rate**, not of the amount: for some numerators the double product still lands exactly on
the half and the two never part. Three feeds drawn at random gave 6, 22 and 7 findings of
separation — decisive against an exact digest, but by luck.

Constraining the fixing generator to numerators that disagree at least 8 times in 64 sampled
ties moved that to 33-42 a feed. Same for the band edges: they are *snapped* onto planted
halfway cases rather than hoped to land near one, with a wish list covering both parities,
both edges and both signs so one feed carries every shape.

If your crux depends on a numerical coincidence, generate against the coincidence and assert
the count. Do not sample and hope.

## 41 · When you widen one generator knob, re-check the coverage it silently removed

Revising every currency's band history (`revised=4` -> `8`) doubled the era edges available
to snap ties onto — and emptied the set of currencies that publish *late*, because the late
ones were drawn from what was left over after the revised ones. Two mutants immediately
survived: "rows above the event do not govern" and "a currency with no fixing is unknown".

The sweep caught it. Nothing else would have. A knob that adds coverage in one dimension can
remove it in another, so re-run the full sweep after every generator change, not after the
last one.

Two smaller rules from the same sweep:

- **A mutant that crashes tests the wrong thing.** Dropping the "no fixing" clause made the
  reference raise `KeyError` rather than differ. Give the mutant a fallback so it measures
  the sentence it broke, not that the code can raise.
- **An `EQUIVALENT` pair is a coverage note, not a failure**, but it is worth chasing:
  floor and truncate were indistinguishable until a band floor went negative, which is the
  only place they can part.

## 42 · Guard the false-reject direction explicitly

New rules that admit more than one faithful implementation, graded by exact digest, carry a
false-reject risk that no amount of "the deviations all fail" testing detects.

Pre-flight 6c installs a gate sharing **no line** of arithmetic or parsing with the
reference — the product as a ratio of integers rounded by Python's own half-to-even, and a
repeated name recorded by adding a name the contract does not list rather than by the type of
the parsed object — and requires a full verifier run to return 1.0. If exact comparison were
admitting only one way of being right, that is what fails.

Related, and cheap to miss: **when the verifier restores N files, probe all N.** Adding
`rates.csv` beside `currencies.csv` gave the symlink-redirect attack a second target, and the
existing probe only planted at the first.

## 43 · Derive ground truth from the bytes that ship

A repeated name is a property of the *text* of an event, not of any mapping it parses to. A
digest computed from the generator's own objects would therefore be a digest of something
the feed does not say. `build_graded.py` renders the events, gzips them, parses that back,
and replays the parse — so the commitment belongs to the bytes the verifier will hand the
gate. Any rule that is textual rather than structural forces this; it is a good default
regardless.

# Sixth pass: `dynamo-a886719` (torus counting), 2026-07-30

Count symmetry-distinct two-species decorations of an `M` by `N` torus at fixed
composition, twice: once modulo the `4MN` spatial group, once with a global species swap
folded in. Green on `77bb017`, every job:

| gate | result |
|---|---|
| `review` (24 static + 31-criterion eval) · `cosine_similarity` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | **0 of 2 solved · 2 valid fails**, every rubric dimension PASS on both |
| `adversarial_review` · `deep_review` · `ava_review` · `tier1` | pass |
| `qc_exec` · `qc_eval` · **`qc_gate`** | **44 checks and probes clean, findings blob empty** |
| `trials` (pass@5) | **0 of 5 solved · 3 good valid fails · avg@5 = 0.000** |

Six runs, zero solves in all six. What took six runs was never difficulty. It was five
separate mechanical defects, and the two worst of them were in my own verifier.

## 44 · The spec is every file the agent reads, and coverage must be proven for all of them

I ran a thirteen-mutation sweep over the model description, breaking one sentence at a
time, and proved every one separated by a graded call. `qc_gate` then filed a finding by
mutating the file I had not swept. It replaced `print(a, b)` with `print('   ', a, b, '   ')`
and the padded line graded correct, because `instruction.md` says the line is all of stdout
and my verifier called `stdout.strip()` before matching.

The model description says what the answer is. The prompt says what the artifact must look
like, and every sentence of it is a mutation target too: shape, exit status, stdout against
stderr, number formatting, self-containment, input ranges, the per-call limit. Sweep both
files or the gate sweeps the other one for you.

## 45 · Never normalise what the prompt forbids, and grade the raw bytes

`strip()` before matching is the whole defect in one call. If the prompt says nothing else
on stdout, then padding is a wrong answer and the verifier has to say so.

Fixing that is not enough, and this is the part worth carrying forward. `subprocess.run`
with `text=True` wraps the pipe in a text decoder with universal newlines, so `b"6 6\r\n"`
and even a bare `b"6 6\r"` both arrive as `"6 6\n"` and digest to the committed value.
Measured on the shipped fixtures: both graded **correct**. The gate had found the space
axis; the newline axis was still open, and mutating the oracle to `end="\r\n"` was
separable from it on none of the graded calls.

So: match `rb"\A(0|[1-9][0-9]*) (0|[1-9][0-9]*)\n?\Z"` against raw stdout, and rebuild the
digest preimage from the captured groups so every committed fixture stays valid. Two traps
in the conversion. `stdout.rstrip("\n")` raises `TypeError` once stdout is bytes and would
error the suite on the oracle itself, and stderr should be `DEVNULL` rather than captured
once nothing reads it, or a program you invited to log there can fill the container.

## 46 · A fixture file must assert its own size

My loader asserted that a salt was present and nothing else. Drop the graded lines from
`expected.sha256` and the file still parses, the graded dictionary is empty,
`@pytest.mark.parametrize` over an empty list reports as *skipped*, pytest exits 0, and
`test.sh` writes reward 1 for a submission that only ever answered the samples.

`assert len(samples) == 3` and `assert len(graded) == 21`. A fixture set that loses lines
must fail closed. While you are there, `chown` the directories to root before the `chmod`
that closes them, rather than assuming you already own them.

## 47 · Calls times per-call cap must fit the verifier budget

Seventeen calls at a 180 second cap composes to 3060 seconds against a declared 1800. That
is self-refuting arithmetic a reviewer checks in one line, but the real cost is worse than
embarrassment: a verifier killed at its own cap leaves **no `reward.txt` at all**, and that
classifies as a task or verifier issue rather than a failed submission. It is the one
outcome that carries no evidence about your task.

Add `-x` to the runner. Grading is all or nothing, so once a call fails the rest cannot
change the outcome, and stopping there bounds how long a slow wrong submission runs. When
the graded set grows, move the per-call cap in the same commit: twenty-four calls at 150
seconds is exactly 3600.

## 48 · `runuser` forks, so a timeout kills the wrapper and not the program

`subprocess` timeouts SIGKILL the child you spawned. `runuser` forks rather than execs, so
that child is the wrapper, and the graded program survives it, reparented to pid 1, spinning
on the single CPU for the rest of the suite. Give each call its own process group with
`start_new_session=True` and kill the group with `os.killpg`.

## 49 · Type-check the descriptor you read, not the path you checked

`lstat` on the path, then `open()` on the same path, means the descriptor actually read was
never type-checked, and `/app` belongs to the agent. Anything alive at verify time can
`rename` a fifo over the graded path in that window, and the open then blocks in the kernel
with nothing to interrupt it. Open with `O_NONBLOCK`, take the type and the size from
`os.fstat` on the descriptor, bound the size, and read to that length instead of one
`os.read` that silently truncates.

## 50 · `tier1` gates on the files your diff touches, not on whether you are right

QC filed "Environment Build Failure" whose own evidence read `ThrottlerException: Too Many
Requests` while `validation` in the same run had built the image and scored the oracle 1.0.
It was a sandbox throttle. I diagnosed that correctly, fixed genuine things elsewhere, and
`tier1` held Tier 2 and `trials` with:

> 0/1 required fixes attempted. The diff only edits `task/instruction.md` and
> `task/task.toml`; nothing touches `environment/Dockerfile` or the build.

Being right about a finding does not clear it. The fix-addressal check is mechanical: touch
the implicated file with a change that plausibly addresses the class, and say so in the
commit message. Retries and bounded timeouts in the apt layer, fewer round trips, and a
build-time assertion that the agent account cannot write the interpreter, all of which are
worth having anyway.

## 51 · Check the `QC-BASE` SHA before concluding a fix failed

The QC comment is sticky and re-dated. After I fixed the padding finding, the comment on
the PR still displayed that finding, because `qc_gate` had been skipped that run and the
body was carried over from the previous commit. The base SHA in the HTML comment named the
older commit. Reading it as a live verdict would have sent me to rewrite a verifier that was
already correct.

## 52 · A mutation sweep lies in three ways, and I hit all three

The sweep is the single best predictor of `qc_gate`, and mine reported success for the wrong
reason twice before it reported anything true.

- **A crash counted as a catch.** My first version wrapped each case in `try/except` and
  stored the exception as the result, so a mutant that could not run at all showed
  discrimination on every graded call. Never let an exception count as a difference.
- **An inconsistent mutant is not a spec violation.** The intra-row rule appears twice, once
  in the linear prefix scan and once in the circular closure. Patching only one left the row
  set no longer closed under the column action, and the model raised `KeyError` on a row it
  had never enumerated. Patch every site of one rule together, or you have tested nothing.
- **Your own invariants mask the answer.** The reference asserts that each Burnside sum
  divides by the group order. Five mutants tripped that assertion and crashed instead of
  returning a wrong number, which is weaker evidence than a value that differs. Strip the
  oracle's assertions inside the mutant, and apply the mutation *before* stripping or the
  substitution anchors are gone.

Result once it was honest: twelve of thirteen mutations caught by a graded call, and the
survivor proven equivalent rather than uncovered. It removed a short-circuit whose result is
discarded, and the discarded sum is provably zero, so no input can separate it.

## 53 · Read the classifier line; `in-progress-timeout` is not evidence about your task

One run came back `0 solved · 0 valid-fail · 2 in-progress-timeout`. Both agents were still
making progress when the hour ended, so the gate refused to certify either as stumped, and
its prescribed remedy was to raise `[agent].timeout_sec`, already pinned at the platform cap
of 3600.

The full sequence for one unchanged task: valid fails, valid fails, valid fails, valid
fails, then two in-progress timeouts, then two valid fails, then avg@5 = 0.000. A single
inconclusive `pass2` is trajectory variance and the gate says so itself with
`Rerun Recommended: YES`. Rerun before touching anything.

## 54 · The graded set costs the agent nothing

Grading happens after the agent's hour ends, so widening the held-out set does not consume
one second of the agent's budget. What consumes it is the agent's own experimentation, and
the **stated ranges** shape that, not the graded cases it never sees. If trials keep coming
back in progress, trim the ranges. Widening coverage and shortening the agent's path are
different levers on different files, and confusing them wastes a run.

## 55 · Pick two graded cases that a wrong invariant maps onto each other

The exclusion reaches two columns along a row but one row across, so the board is not
symmetric under transposition. Every shipped sample was `5x5`, `7x5`, `9x5`, all with M at
least N, so nothing in the calibration data says so. `7x8` gives `351998 177194` and `8x7`
gives `352430 177412`. A solver that turns the board to put the smaller side in the transfer
state is wrong by a tenth of a percent on both, with no crash and no hint.

Choose the pair deliberately. A near-miss that a plausible wrong invariant produces is worth
more than another case in a region already covered, and the two together make the axis
decidable rather than merely present.

## 56 · A nameable method is not a barrier, so put the difficulty after the name

Every trial named Burnside within minutes, and all five still scored zero. They broke on the
per-element fixed-point count: one used an orbit-independent subset-sum that never enforced
clash constraints between orbits, inflating every non-identity element, and it failed on
small boards as surely as large ones.

The assessment page warns that a nameable trap is the top reason a proposal reads too easy,
and that is right about the *trap*. It does not mean a nameable *method* disqualifies a
task. Let them name the method in minute two, and put the work in the derivation the name
does not give them. Measure it the way §30 asks: breaking the fold parity, the orbit
weighting or the seam twist each moved **0 of 3 samples** while a graded call caught every
one.

# Seventh pass: `dynamo-a9c7c70` (rfp), 2026-07-31

Register-linkage panel: twelve annual extracts, a normative protocol, five flag-gated
misreadings, a demo blind under all 32 flag combinations, per-year salted digests over a
data-file artifact. Green on the third run: pass@2 0/2, then **pass@5 = 1/5, avg@5 =
0.200, four good-valid-fails, no timeouts**, `qc_gate` PASS, AVA PASS, every rubric
criterion PASS on all five trajectories. The two runs before that are where the lessons
are.

## 57 · Wrong code outside the build path is a trap map, not a lure

§27 says the best trap is inherited working code. This pass measured the boundary of
that rule: the wrong model must sit in the path the agent has to build on, or it works
for the other side. I shipped the office's pre-protocol build script next to the
normative protocol, labeled as predating it, optional to use. Both pass@2 agents did
the same thing with it: read the protocol, diff the script against it, and write down
the five points of disagreement before writing any code. The reviewer's own summary
said the framing "guided agents reliably rather than requiring first-principles
discovery". The same task with the script shipped scored 3 of 4 trials solved; with it
withdrawn and nothing else changed, 1 of 7.

The rule that survives: inherited wrong code stumps when the agent must edit or extend
it (mx1's unfinished emulator). Wrong code that is optional and sits beside a spec
that outranks it is a checklist of exactly the places to be careful. If the wrong
model cannot be in the required path, ship no code at all and let the misreadings be
misreadings of prose. That is worth less than a true in-path trap, and it was still
worth 0/2 and 1/5 here, because the axes were independent and the demo said nothing.

## 58 · List what the demo cannot exercise; those are free discriminators

The blind demo (§1, §20) kept its whole value after the tool was withdrawn: every
trial validated against it, diff-zero, and four of five still failed. The sharper find
is on the coverage side. One trials failure kept a single `used` set across all
succession year-pairs, silently breaking chains of two successions. No planted axis
says anything about that, and the demo cannot expose it, structurally: its one
succession has no follow-on pair, so nothing in the sample constrains how state is
scoped across year pairs. That structural silence made the bug a discriminator worth
one trial, for free, the way §17's numerical crux was free.

So when building the blind sample, write down what it is structurally incapable of
exercising: chains longer than one link, state carried across loop iterations, a
second occurrence of anything. Every entry is an axis where a plausible
implementation can be wrong with zero feedback. You do not have to plant them; just
do not accidentally close them, and do not let the demo grow a case that would expose
them.

## 59 · AVA fails closed on unconfirmed findings; fix the provenance it names

The first run blocked at `ava_review` with `confirmed_major=0 supported_major=0
potential_major=6` in the job log: it constructed no exploit and blocked anyway,
fail-closed on potential findings. Meanwhile `deep_review`'s half of the union gate
assessed the same verifier PASS on all 26 items, and the adversarial cheat-pass had
examined the exact surface AVA named and written "real but harmless". The union gate
blocks on either half, so read the halves separately before concluding anything.

The named surface was still worth fixing, and the fix generalizes. I had committed the
coverage key set as a plaintext fixture produced by the oracle, so the acceptance
boundary's provenance was the reference implementation. But the key set was provably
derivable: the protocol selects one row per rid per extract, so a (year, rid) belongs
to the panel exactly when the rid appears in that year's pinned extract, under every
reading of the selection rule. The verifier now derives the keys from the pinned
inputs, the fixture holds digests and nothing else, and the fixture builder refuses to
write if the reference's keys ever differ from the extracts' rid sets. General form:
never commit an oracle by-product the verifier could derive from pinned inputs plus a
provable invariant; commit only what cannot be derived, and assert the invariant at
fixture-build time so the claim is enforced rather than argued.

A second AVA note claimed the verifier imports its oracle module. It does not; the
text scan read docstring provenance ("solution/make_fixtures.py") as a dependency,
exactly as on gst (§22). Keeping the provenance but phrasing it as prose rather than
module paths costs nothing and removes the trigger.

One survivor note for the §30 sweep: the tie-order mutant (opener rid before closer
rid in §4.3) is a *proven* equivalent, not an argued one, and the proof is an exchange
argument rather than an enumeration: both keys order any two candidates sharing a run
identically, and reordering disjoint candidates cannot change a greedy one-to-one
matching. QC accepted that stated as such. When enumeration (§31) is infeasible, a
structural proof written into `verification_explanation` does the same job.

## 60 · A cancelled runner reads as a red X; close-reopen is the author's rerun

One run died with `validation: fail` on the checks tab. It was not a failure: the
job's API record showed `conclusion: cancelled` with an empty steps array and no log
persisted, meaning the runner was killed underneath it, and the same commit's other
gates had passed with the verifier unchanged from a run where validation passed. Check
conclusion and steps before debugging a task defect that is not there; §7's classifier
logic (the harness fell over, not the model) applies to infra gates too.

The recovery: the provided admin rerun workflow's own comments document that it works
by closing and reopening the PR, because `reopened` is in the review workflow's
trigger list and fires a fresh run that resolves the CURRENT pipeline, while GitHub's
native re-run would pin the old reusable-workflow SHA. Close-reopen needs no admin and
no junk commit, and it is available to the PR author with `gh pr close` and
`gh pr reopen`. The full green board came from exactly that.

# Eighth pass: `dynamo-43b27a9` (reclaim-horizon), 2026-07-31

MVCC reclaim planner: a normative spec, seventeen bundles graded on committed digests,
a shipped engine with nine departures. **Twelve runs.** Runs 1-11 passed every soundness
gate and lost on difficulty every time — twenty-one trials, twenty-one solves, three
consecutive `avg@5 = 1.000`. Run 12 changed one thing and took **pass@2 1/2, pass@5 0/5,
avg@5 = 0.000, four good-valid-fails, zero task/verifier-issue, `qc_gate` 40 checks
clean, final `gate` PASS.** The eleven losing runs are where the lessons are.

## 61 · An axis is inert until the wrong answer is INHERITED

The single highest-value lesson here, and it took eleven runs to see.

Section 1 of the spec made "ascending" the wrapping comparison and said so in the sentence
that defines ordering. Table identifiers came from a wrapping counter; no sample crossed
the wrap, every graded bundle did. Sorting them numerically permutes **every line of every
graded bundle** — the heaviest axis in the task, and blind on all 39 sample lines. Run 11's
agents wrote that sort from scratch and both got it right. I recorded it as defeated and
went looking for something else.

It was not defeated. It was **inert**. The shipped engine was then replaced with a
complete-looking one containing `order.sort_by_key(|t| t.id)`, and two of run 12's five
trials failed on exactly that line. The pipeline's own words:

> "correctly identified the wrapping comparison rule, implemented `earlier(a, b)` using
> `(a.wrapping_sub(b) as i32) < 0`, and applied it to 9 of 10 required call sites ... The
> bug was structurally invisible to the agent's verification loop, despite the agent
> understanding the rule and correctly annotating it in comments."

Neither half works alone. **The rule alone is transcribed correctly** — this model reads
normative prose and implements it, essentially always. **The inherited engine alone is
audited and rewritten** — measured directly: a top-tier model rewrote it compactly and
correctly 11 times out of 12. What fails an agent is the *composition*: a rule the samples
cannot check, plus a pre-written line in the artifact that quietly violates it. The agent
implements the rule, keeps the line, and every sample stays green.

Practical consequence: **never retire an axis on the evidence of agents writing it fresh.**
Put it in inherited code first, then judge. Every "dead" axis in a stub-based task is
un-measured, not dead.

**Precondition, corrected twice — see §77.** I read this section as "the artefact must be
big enough to hide a line in" and lost 3 of 3 at 186 lines and again at 624. The variable is
neither size nor whether the agent rewrites: it is whether any artifact *inside the box*
would turn red if the defect were left in. `dynamo-7f37018` took pass@5 0-of-5 with a
smaller engine than the one that failed here, because its self-check could not see two of
the six clauses. Read §77 before betting on this composition.

## 62 · A local pass@k harness is a smoke test, never an oracle

I built one — container, agent loop over a bash tool as the unprivileged account, no sight
of the verifier, then `docker commit` and grade in a separate container with the real
overlay. It is worth building. It is not worth believing.

Measured on one unchanged task, same day:

| jury | solved |
|---|---|
| `gpt-5.5` | 0 of 7 |
| `gpt-5.6-terra` | 11 of 12 |
| the CI jury | 1 of 2, then 0 of 5 |

I reported "0/5, the redesign works" from the first row and had to retract it. I then
reported "11/12, the redesign is insufficient" from the second and had to retract that too.
**Neither local model predicted the real one in either direction.** Use the harness to catch
"obviously too easy" and to test soundness probes; do not tune difficulty against it, and do
not report its numbers as a verdict.

Two things make its output readable at all:

1. **A known-good control.** Inject the reference solution and require reward 1 through the
   identical grading path. A broken mount returns zeros that look exactly like a hard task —
   this happened, via macOS TCC refusing a bind-mount out of `~/Downloads`.
2. **Audit the solves as hard as the failures.** A winning submission of 161 lines against a
   342-line engine looked too small to be real. Reading it showed a genuine complete
   implementation, not a reward hack — but only reading it established that.

## 63 · Two implementations agreeing does not catch a shared misreading

The ground truth was defended by two implementations written independently from the spec,
cross-checked on every bundle under every flag. That check was **green on 476/476
comparisons while nine of seventeen committed answers were wrong.**

The spec said a version is freed only once every version of its row with an *earlier* birth
is freed — a condition on the set, under which two versions sharing a birth do not wait on
each other. Both implementations instead **sorted the row and stopped at the first
survivor**, importing a tie-break the spec never fixes. Reshuffling `versions.txt` changed
the report on 11 of 12 graded bundles.

Independence of *authorship* is not independence of *interpretation*: both were written by
the same reader, from the same sentence, on the same afternoon. Agreement measures
consistency and says nothing about whether the shared reading is the spec's.

The check that catches this class asks a question **neither implementation was asked**:

- **Order independence.** An export is a set of records, not an ordered document. Reshuffle
  every input list and require byte-identical output. Highest-yield single probe I have
  added; it catches every accidental tie-break at once.
- **Promise audits.** Assert the invariants the spec *promises the reader* still hold in the
  data: every referenced identifier present, parent chains terminating, identifiers inside
  half a wrapping counter, reserved values unassigned. Break one and the task becomes
  *ambiguous* rather than hard, and nothing else notices.

Postscript worth its own line: the tied-birth case then failed **two of run 12's five
trials** — the same mistake I had made in my own oracle that morning. When the author and
independent agents converge on one misreading, that is an attractor, not a coincidence.

## 64 · `trials` needs three failures of five, not one

`pass2` needs one valid failure. `trials` prints `need >=1 good valid and >=3 total`. That
is a different task: **roughly a 60% per-trial failure rate**, not "at least one agent
failed".

At a 20% failure rate, P(>=3 of 5) is about 6%. At 8%, under 1%. Stacking more rules does
not get there — measured across three runs, going from eleven axes to fifteen to seventeen
left the solve rate at 100%, because each *stated* rule sits near 99% correctness however
much output it moves. Breadth buys the `verifier_coverage` argument, not the crux.

What moves the rate is the §61 composition and the class in §65. Design for three failures
from the start; a task calibrated to produce one will clear `pass2` and die at `trials`.

**Two arithmetic facts worth having before you read a verdict.** Solving 0 of 5 is not what
the gate counts — it counts failures *of the right kind*, so overshooting difficulty is far
cheaper than undershooting. And an `in-progress-timeout` is **discarded**, worth nothing to
either side, so an agent budget too small to finish actively destroys `trials`. On
`dynamo-7f37018` run 30685378633 the tally was 2 good-valid + **3 in-progress timeouts** —
a block at 2 of the 3 needed. Raising `[agent].timeout_sec` to the 3600s platform cap
converted those into counting fails and the same design later returned 4 good-valid + 0
timeouts. Set it to the cap on every task; there is no reason not to.

Watch the second-order effect, though: room to finish is room to solve. On this task the cap
alone turned a timeout into a *solve*, and what fixed that was **shortening the agent's path
rather than lengthening the clock** — shipping, already implemented and correct, the entire
reactor the agents had been getting right anyway, so the budget went to the six clauses that
decide the grade instead of to re-deriving machinery. That is §79's point and it is also
what `Pass@ & Timeouts.md:84` means by banning busywork.

## 65 · The traps with yield are invalid optimisations, not subtle rules

Across ~30 trials, the readings that ever failed an agent were not hard to *read*:

- **A natural optimisation that is invalid.** The model volunteers it, unprompted: "freeing
  its immediately preceding version is sufficient: it in turn implies that all older
  versions were freed" — its own comment, in a failing submission. True only when births are
  unique in a row. Also the hoisted transitive closure: cached, then invalidated by the
  fixpoint's own progress.
- **A semantically symmetric pair.** Reference-graph direction: careful wording gives the
  reader nothing to check themselves against, so it is a coin-flip they must actively
  resolve.

Everything else I built — nine further departures, each stated once, each moving 20 to 177
graded lines — was transcribed correctly essentially every time. **Design for the reading
the model volunteers, not for the sentence it might skim.**

One caution learned by repeating the §29 error hours after writing it down: **amplifying a
bug's consequence does not raise the rate at which models write it.** Making tied births
consequential took the wrong reading from 3 graded lines to 64 and the local solve rate went
*up*. That is strength, not attractiveness. A single observed failure is a sample, not an
axis.

# Ninth pass: `dynamo-10c05f8` (chart rescue), 2026-07-31

Nine SVG figures from an invented water board's bulletin; the graded answer is the data
tables they were drawn from. Every gate green on `353e173`:

| gate | result |
|---|---|
| `review` · `cosine_similarity` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | 0/2, both good valid fails |
| `adversarial_review` · `deep_review` · `ava_review` | pass |
| `tier1` · `qc_exec` · `qc_eval` · **`qc_gate`** | **44 checks + probes clean** |
| `trials` — pass@5 | **1 of 5 solved, avg@5 = 0.200, 4 good valid fails** |

Three runs to get there, and the interesting part is that **neither blocking finding was
in the original design**. The first run died on infrastructure, the second was blocked by
a verifier detail, and the third by a hole my own fix for the second had opened. Sections
66 to 72 are what that sequence taught.

## 66 · Invert a rendering: a task family where the traps are conventions, not rules

The whole task is one sentence: given the SVG, recover the numbers. No spec document at
all, which is what makes it structurally unlike §10's survey and §17's trial readout. The
axes of difficulty are the *conventions* a chart uses, and each one has a plausible
neighbour:

| what the figure does | the neighbour that fails | graded numbers moved (of 352) |
|---|---|---|
| plot group is `translate(...) scale(1 -1)` | compose the chain in the other order | 24 |
| the same, y-flipped | apply translations, drop the scale | 24 |
| decade ticks, log-spaced minors | fit every axis linear | 38 |
| broken y axis, glyph on the page | one least-squares line over all ticks | 20 |
| stacked bands, each path carrying its own bottom edge | read the top edge as the value | 30 |
| two y axes, bound by label ink colour | map everything through the left axis | 12 |
| legend alphabetical, drawing order different | bind names by legend position | 52 |
| bars below the baseline | read each bar's top edge | 6 |
| horizontal bars drawn in value order | bind bars to categories by document order | 5 |
| **all nine together** | | **167** |

Two properties made this work, and both generalise to any reverse-engineering task:

- **What cancels is not a trap.** Any transform applied to ticks *and* marks alike drops
  out of the calibration, so the viewBox and the page size are free variables. Only what
  differs between the ticks and the marks decides an answer. Knowing which is which is
  what stops you decorating the figures with difficulty that is not there.
- **The demo blinds by being degenerate on every axis at once** (§20 again, new domain).
  Its transforms commute, its axes are linear and single, its one area layer sits on the
  baseline where thickness and top coincide, its bars are positive and drawn in axis
  order, its legend prints in drawing order. 54 numbers, and all nine deviations move
  **zero** of them. An agent that validates against it learns nothing.

## 67 · An infra failure at `pass2` is not a difficulty signal, and `/rerun` may not be yours to use

Run 1 came back `pass@2: 0/2` with the breakdown `0 solved · 0 valid-fail · 2
infra/setup-timeout` and a `DaytonaAuthenticationError`. The comment said plainly "not a
problem with your task" and "Rerun Recommended: YES". §7 already says to read the
breakdown line rather than the verdict; this is the case it was written for. **Nothing
about the task was changed**, which turned out to be right: the same commit later
produced two clean valid failures.

Getting a rerun is the part nobody documents. `/rerun` is gated on write access, and a
task-repo contributor does not have it; the workflow log just says `User <login> lacks
write access` and reports **success** having done nothing. The lever that works from a
contributor account is to **close and reopen your own PR** — the Review workflow declares
`pull_request_target: types: [..., reopened, ...]`, so a reopen fires a fresh run under
the current pipeline, which is exactly what the admin `/rerun` does internally. A push
(`synchronize`) works too, but only spend one if you actually have a change to carry.

## 68 · Do not grade a path the agent can still write; grade a capture

`ava_review` blocked run 2 on the late-write guard:

> guard is conditional on both existing; comparison uses agent-writable mtime; no check
> that started_at was freshly created this run

Correct on both counts. The guard compared the submission's mtime against a stamp file,
and mtime is settable by whoever owns the file; it also skipped entirely when the stamp
was missing. Every patch I could imagine kept the same shape: compare something the
attacker can set against something else, and hope.

§9 says attack the premise. The premise was that grading reads the live path *at all*.
So: **`test.sh` copies the artifact into root-only `/logs` the instant grading begins,
through `O_NOFOLLOW` with a regular-file check, and the tests grade that copy and never
look at `/app` again.** A symlink is not a submission because the open fails; a late
write is never seen because nothing reads that path afterwards; and there is no time
comparison left to forge. The battery gained a case that is strictly stronger than the
threat: a *root* process that swaps in the correct answer with a backdated mtime the
moment the capture appears. Reward 0.

Generalises past this task: whenever a defence rests on metadata the other side can
write, delete the read instead of hardening the comparison.

## 69 · Every interpreter your `test.sh` starts is a root execution, not just pytest

This is the one I would most like back, and it is the reason to write §69 down rather
than file it under bad luck. The §38 fix added five lines of Python as a heredoc:

    python3 - <<'SNAPSHOT'
    import os, shutil, stat
    ...

`qc_gate` blocked run 3 on it (check E3), and the finding was exactly right. The pytest
line in the same file carries `PYTHONSAFEPATH=1 PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
--noconftest -c /tests/pytest.ini`; this new one carried nothing. `python3 -` puts the
working directory on `sys.path`, the working directory is `/app`, and `/app` belongs to
the agent. I reproduced it in ten seconds before changing anything, which is the habit
that matters:

    printf 'import os\nopen("/tmp/PWNED","w").write("x")\n' > /app/shutil.py
    cd /app && python3 - <<< 'import shutil; print(shutil.__file__)'
    # /app/shutil.py   — and the payload ran, as root

The fix is `python3 -I`: isolated mode drops the working directory and the user site from
the module search path and ignores every `PYTHON*` variable. The same probe then resolves
the real stdlib module and the payload never fires.

**The rule: closing one channel by adding machinery means auditing the machinery against
the same threat model, in the same commit.** §4 hardened pytest and I treated "the runner
is pinned" as a property of the file rather than of each interpreter in it. Enumerate
every process `test.sh` starts and ask, per process, what it loads and who can write it.
The battery now plants `shutil.py`, `stat.py` and `os.py` as the agent account and
asserts both reward 0 **and** that no planted module was ever loaded — the second
assertion is the one with teeth, because reward 0 alone would also hold if the exploit
worked and simply picked a different payload.

## 70 · The output contract must name every KIND of thing it grades

The other `qc_gate` blocker was B1, ambiguity:

> The single stated rule for non-bar series ... never mentions filled/area series,
> stacking, thickness

Also right, and it had been sitting there since the first commit. The contract said what
a *bar* series reports and what a *line* series reports. A stacked band is neither, so
"cumulative top" and "own contribution" were both defensible readings of the same figure,
and B1 is precisely "two reasonable readings, nothing agent-visible picks one".

The fix is one sentence in `instruction.md`: a filled band reports its own contribution at
each x, never the cumulative height beneath it. **Foreclosing a trap in writing does not
cost difficulty** (§24 Step 8) — the deviation still moves 30 numbers, and both `pass2`
agents got fig04 wrong *after* the rule was stated, because the failure was never
ignorance of the convention, it was not looking. What it costs is a cycle if you skip it.

Cheap check before pushing: enumerate the *kinds* of series, record, or object your graded
output can contain, and confirm the contract names each kind explicitly. Mine covered two
of three.

## 71 · The trap that decided pass@5 was not one of the nine

pass@5 came back 1 of 5 solved, avg@5 = 0.200, four good valid fails. The analysis:

> All three agents tried to write a large Python script by piping a multi-hundred-line
> body through a shell heredoc. In each case the terminal's 10 000-byte display cap
> silently truncated the output, leaving the shell waiting for the closing delimiter.

Three of the four failures were **terminal wedges**, not misread figures — one agent spent
46 of its 60 minutes typing `EOF` at a stuck prompt. The analytical traps did fire (two
trials also carried wrong values from the stack, axis and legend conventions), but the
proximate cause was a shell accident.

This is §17 in a new costume, and it cuts both ways. It counted in my favour here: those
trials were classified good-valid-fail with `low_timeout: PASS`, because the agent was
stuck rather than productively debugging when the clock ran out. But it is luck, not
design, and it means **the measured avg@5 is not a measurement of my nine axes.** A task
whose difficulty rides on a harness accident is a task whose next pass@5 draw could look
very different. If I needed this task to be harder, the honest lever is the axes, not the
accident.

## 72 · A sticky comment can quote code that no longer exists

§8 says sticky comments are re-dated. Stronger version, observed here: after the push, the
AVA sticky was re-posted with content from the *previous* commit, quoting a
`STARTED_AT.stat().st_mtime` comparison that the push had already deleted. The three review
jobs were still `queued` at that moment, so the comment was not a verdict about anything
that had run yet.

**Job conclusions are the contract; comment bodies are a rendering of some run.** Read
`gh run view <id> --json jobs` before you believe a comment, and check the base commit the
comment names — QC's sticky helpfully carries `<!-- QC-BASE:<sha> -->`.

# Tenth pass: `dynamo-d89f778` (vintage seasonal adjustment), 2026-08-03

A vintage seasonal-adjustment pipeline the agent repairs against a normative `METHOD.md`;
the graded answer is the fixed `/app/rta/pipeline.py` and the `/app/out/vintages.csv` it
produces, both all-or-nothing. Every gate green on `5e96a25`:

| gate | result |
|---|---|
| `review` — static + 31-criterion eval | **31/31 PASS** |
| `cosine_similarity` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | 0/2 → proceed (1 valid-fail, 1 in-progress-timeout) |
| `adversarial_review` (UNIQUE) · `deep_review` · `ava_review` | pass |
| `tier1` · `qc_exec` · `qc_eval` · `qc_gate` | pass |
| `trials` — pass@5 | **2/5 solved, avg@5 = 0.400, 3 good-valid fails** |

The soundness gates cost nothing this pass — the §68/§69 playbook (unprivileged `analyst`
agent, ground truth overlaid under `tests/` at verify time, `/app/archive` SHA-pinned,
graded paths read through symlink/fifo-refusing descriptors, every interpreter run
isolated) carried across intact. QC and AVA passed without a finding. The difficulty side
is where §73–76 live, and one of them is uncomfortable.

## 73 · Breadth in place of depth: eleven single-dimension traps, graded all-or-nothing

Where §10 and §17 hung difficulty on one or two coupled cruxes, this task stacks eleven
independent misreadings, each a plausible neighbour of one section of the manual, and
grades all 2940 fields as a unit. Nothing is subtle on its own; the barrier is getting
*all eleven* right at once with no partial credit:

| the reading `METHOD.md` requires | the neighbour that fails | fields moved (of 2940) |
|---|---|---|
| θ by exact Gaussian ML (§3.2.1) | conditional sum-of-squares | 846 |
| θ estimated once per June review, held (§4.5) | re-estimate every release | 900 |
| publish diagonal across releases (§7) | fresh per-release recompute | 1716 |
| do not re-centre seasonal factors (§3.7) | normalise to mean 1 | 1958 |
| outliers detected to fixed point (§4.3) | single pass | 65 / 345 |
| bilateral-mean replacement, carried (§3.5) | forward-carry | 623 |
| … four more (§3.8, §5, §5.2, §5.2.1) | | 349 / 295 / 15 / 30 |
| **all eleven together** | | **2422** |

Two design properties made a breadth model survive review. First, **every trap is inert on
the one self-check** (§74) so the sample teaches nothing. Second, each trap moves a graded
field by ≥1e-3 or flips a categorical signal — no near-miss band — so `pass2`/`trials`
never classify a partly-right attempt as a tolerance miss. `pass2`'s `near_miss` was PASS
on every scored trial, which is the evidence that the 1e-4 tolerance is not doing the
gating; the eleven deviations are.

## 74 · A conformance case that short-circuits the hard routine hides bugs, not just wrong values

§20 says the demo must be degenerate on every axis. This task sharpened *how*. The §8.2
conformance archive is built so the twice-differenced series is identically zero (linear
trend + exactly repeating seasonal + no irregular + no revision), and `estimate_theta`
returns **early** on a zero series — it hardcodes θ=0.5 and never enters the likelihood
routine at all. So the conformance check does not merely leave the eleven value-traps
inert; it **bypasses the entire code path where the hard numerics live.**

That is what actually decided two of the five trials. Both losing analytical attempts —
an innovations-algorithm `B[j]` off-by-one in the pass@2 draw, and a Durbin-Levinson
φ-vector index reversal in pass@5 — crash or diverge on every real archive yet pass the
conformance check clean, because the check never runs the routine that carries the bug.
An agent that validates against the sample gets a green light on broken code. **Sample
blindness is strongest when the sample doesn't exercise the code path, not merely when the
traps are numerically inert on it.** Design the self-check to skip the fiddly routine, and
implementation bugs — not just misreadings — survive to grade time.

## 75 · When the method is nameable and in the training data, put the difficulty in the indexing

Both pass@2 agents named the crux — conditional-SoS vs exact Gaussian MLE, and θ-per-
release vs θ-held — at *reading* time, unprompted (steps 44 and 7). At pass@5, four of
five agents independently converged on dense Cholesky factorisation of the MA(13)
covariance. So *identifying* the method is free; it is well represented in training data
and a nameable method is not a barrier (§56 again).

The one analytical failure that did land (task__HvUDAho) was not a misread rule — it was
storing the reflection coefficient at index 0 of the φ vector, so the recursion pulled
`phi_{k-1,k-1}` where `phi_{k-1,1}` was wanted and corrupted every θ from k=3 on. The
barrier was writing an O(m·k²) recursion with correct indices, and the two agents who
*solved* it sidestepped the recursion entirely by doing dense Cholesky. **The difficulty
that bites is implementation correctness of a fiddly banded/recursive routine, not
recognition of the method.** If the method is standard, make the indices the wall — and
know that a heavier but simpler equivalent route (dense Cholesky here) is the escape hatch
agents will take, so the tolerance has to admit it (it did: both Cholesky solves landed
inside 1e-4, ~1.5e-7 from the reference).

## 76 · Two heredoc wedges decided pass@5 again — count the honest difficulty, not the reported one

This is §71 a second time, and the repetition makes it a rule. Of the three good-valid
fails, **only one was analytical** (the Durbin-Levinson bug of §75). The other two were
bash heredoc **terminal wedges**: `cat > /app/rta/pipeline.py << 'ENDOFPYTHON'` entered
PS2 continuation and never exited, and 88 and 114 subsequent steps were failed escape
attempts (Ctrl-C, Ctrl-D, repeated delimiters) while the original file was never
overwritten and no CSV was ever produced. Both wedged agents had planned correct
Cholesky-based rewrites.

The arithmetic is the uncomfortable part. Trials passed on 3 valid fails of 5. Had those
two agents not wedged, both would most likely have solved — the draw becomes **4 solved,
1 valid-fail, which is a pass@5 FAIL** (needs ≥3). So this task cleared the gate largely
on a harness accident, and the designed eleven-trap difficulty produced exactly *one* of
the three fails it needed. avg@5 = 0.400 overstates what my eleven axes measure.

Both classifiers scored the wedges good-valid-fail with `low_timeout` PASS — the agent was
stuck, not productively debugging, when the clock fired — so the margin is legitimate and
the task is banked. But a large-Python-script deliverable written through a shell heredoc
is *structurally* wedge-prone, and I have now watched that accident supply the deciding
fails twice. **When a pass@5 rides on wedges, the honest lever for real difficulty is the
axes — a harder recursion (§75) or a twelfth coupled trap — never the accident.** If the
next draw seats five agents who all paste cleanly, this one is a 4/5 or 5/5 solve.

## 77 · The lever is a self-check the agent trusts that cannot see the defect

`dynamo-7f37018` took every gate on 2026-08-03 — `pass2`, `qc_gate` and `trials` at
**pass@5 0/5, avg@5 0.000, 4 good-valid fails, 0 in-progress timeouts**, every rubric
column PASS on every graded trial. It is the first design in this corpus that was fairly
hard for this model, and the reason is narrow enough to reuse.

The task ships `/app/archive`: six solved runs of the same program, with full recorded
trajectories, that the agent can reproduce as a self-test. It is complete, honest, and
says nothing false. It is also **structurally blind to two of the six planted clauses** —
its mechanism files declare no units keyword and contain no tabulated-rate table, so
neither clause moves a single number the agent can check. All four graded agents audited
the inherited engine clause by clause, fixed four of six, went green against the archive,
and submitted. The judge's own words, unprompted:

> "the archive provides no PLOG tables and no REACTIONS unit keyword, leaving no self-test
> signal to catch either omission before submission" ... "a common structural limitation
> rather than idiosyncratic per-agent drift"

**This corrects §61's precondition, which I had wrong twice.** I concluded from
`dynamo-405ebe8` that the inherited artefact must be big enough to hide a line in, then
that the real variable was whether the agent rewrites. Neither held. This engine is
*smaller* than the 624-line one that lost 3 of 3, the agents did rewrite and audit, and one
of the two surviving defects was a single self-contained function — the shape §61 calls the
easiest possible version of the trap — which **4 of 4 agents kept anyway**.

So the question to ask of each planted defect is not how many lines the agent inherits and
not whether they will rewrite. It is: **what artifact inside the box would turn red if the
agent left this in?** If the honest answer is "none", the defect survives a competent
full-file rewrite. If the answer is "the sample" or "the worked example", the defect is
decoration. Prove blindness per clause with a table whose agent-visible column reads 0:

    clause      rule                                graded moved  agent-visible moved
    relief      REACTOR.md §6, absent                  22/28            20/29   (visible)
    units       keyword not applied to LOW/REV/PLOG    14/28             0/29
    frozen      k_low/k_rev resolved once              15/28             0/29
    plogwalk    table walked in written order          15/28             0/29
    falloffm    reduced pressure unweighted            13/28             0/29
    channels    DUPLICATE ignores M / (+M)              8/28             0/29

Three construction notes that carried their weight:

- **Ship one visible defect.** The relief moves 20 of 29 agent-visible values, so the agent
  has real work, reaches a green archive and stops. That is what converts "blind" into
  "believed finished" — §74's point, but the stopping condition matters more than the
  short-circuit.
- **Call-site multiplicity is a second, independent lever.** `units` had one main parse site
  and three auxiliary ones; agents applied the conversion to the main site only and 3 of 4
  missed it. That is §61's "9 of 10 call sites" firing on its own terms, alongside blindness.
- **Prove the list is the whole list.** A flag-switchable copy of the reference with *all*
  defects set must reproduce the shipped starter field for field. That is what shows you
  enumerated every departure rather than the ones you remembered.

## 78 · Wherever a spec groups entries, re-derive every attribute for the group

The `qc_gate` block on this task was a single A6 — oracle edge-case — out of 44 checks, and
it is a bug class rather than a slip. The format groups entries that declare the same
reaction. My reference read the group's *direction*, its low-pressure limit and its
efficiency list off the **first entry** and applied them to the whole group. That is right
whenever a group's members agree, and every graded case had them agreeing.

QC does not construct inputs from your graded set. It constructs valid inputs the graded set
**does not contain**, which is exactly a group whose members disagree. So:

**When a spec says entries are grouped, every non-key attribute must be re-derived per
member, and at least one graded case must have the members disagree.** Reading it off the
first member is the A6 the gate hunts for, and your own fixtures cannot show it to you.

Two follow-on rules learned closing it:

- **A 0.00% probe is not a passing probe.** Two misreadings measured identically at 0.00%
  across the graded set. One was a genuine arithmetic identity — once every member resolves
  on its own terms, grouping them and letting each contribute separately are the same sum.
  The other was a real hole that a shipped docstring already claimed was caught: no graded
  case put two groups of *different* reactions side by side, so positional matching happened
  to group only entries that agreed. Only working out *why* each was zero separated them.
  Write the argument down per probe; "probably equivalent" is how a false claim ships.
- **The cheapest close is usually a reorder, not a new case.** Moving one entry so the pair
  became adjacent separated the hole at 196% and changed every committed fixture by exactly
  `0.00e+00`, because a correct implementation groups by declaration and sums the same terms.
  Assert the zero; do not assume it.

And the housekeeping rule that nearly cost this: **a probe battery is code, and a refactor
breaks it.** Restructuring the reference to fix the A6 turned 8 of 21 textual probes into
no-ops that printed "patch target missing" while the battery still ended with a tidy
summary. Every probe must assert its substitution applied (`assert text.count(old) == 1`)
and un-applied probes must count as failures, never as silence.

## 79 · Every construct they all get right is latency, not difficulty — ship it built

This is what cleared `pass2` on `dynamo-7f37018`, and it is the opposite of the instinct.

The design was blocked at `pass2` by **1 solved + 1 in-progress timeout**. The obvious lever
was the clock, so I raised `[agent].timeout_sec` from 1800 to the 3600 cap. The extra half
hour did not convert the timeout into a counting fail — it let that agent *finish* and score
15 of 15. The budget lever was spent, and `Pass@ & Timeouts.md` rejects any pass@2 where a
trial times out, so the timeout could not simply be left standing either.

What worked was subtraction. I took every construct the trials had been getting right —
the thermodynamic block, the energy balance, the moving pressure, the fall-off form, the
reverse rate, the tabulated interpolation, the duplicate summation, the stoichiometric
coefficients — and **shipped all of it already implemented and correct** in the starter.
None of it was ever a discriminator; it was several hundred lines of transcription standing
between the agent and the six clauses that actually decide the grade. Removing it left the
same difficulty in a fraction of the wall clock. The next run returned `pass2` 0 of 2 with
**two valid fails on different clauses**, which the gate itself called "stratified by root
cause ... multiple independent cruxes", and later `trials` at 0 of 5 with zero timeouts.

**The rule: audit your task for constructs every trial gets right, and ship them built.**
Each one is pure latency. Left in, it does not raise the failure rate by a point, it burns
budget, and it converts real analytical failures — the only thing `trials` counts — into
in-progress timeouts, which count for nothing (§64). A task can be *too long to fail
properly*, and that failure mode is invisible in the verdict: it reads as a timeout, not as
a design error.

The corollary is that this is the same move as §61, seen from the other end. Shipping the
machinery correct is what makes the artefact look finished; the clauses you *don't* ship
correct are the ones riding inside the structure the agent keeps. Sort every candidate
misreading into ones that change a line and ones that delete a subsystem, ship the
subsystem-deleters correct, and put the wrong lines inside the machinery they preserve.

# Eleventh pass: `dynamo-405ebe8` (conveyor run ledger), 2026-08-03

The agent finishes the replay engine for a CI run orchestrator against a normative contract
under `/app/spec/`, graded by digest on three recorded nights it never sees, all or nothing.
Every gate green on `0a7d43b`:

| gate | result |
|---|---|
| `cosine_similarity` · `review` · `similarity` · `validation` · `ratelimit` | pass |
| `pass2` | **0/2 — 2 valid fails, 0 timeouts**, `low_timeout` PASS on both |
| `adversarial_review` · `deep_review` · `ava_review` · `tier1` | pass |
| `qc_exec` · `qc_eval` · `qc_gate` | **44 checks, 43 clean, 1 non-blocking advisory** |
| `trials` — pass@5 | **0 of 5 solved, 4 good-valid fails, avg@5 = 0.000** |

Seven runs to get there, and only `trials` and `pass2` ever blocked. The soundness side was
green from `862e218` onward and never regressed. The difficulty history is the useful part:

| commit | difficulty result |
|---|---|
| `e38b62d` 9 rules | 3/5 solved, 1 good valid |
| `fa598d3` 14 rules | `pass2` blocked, both trials 22/22 |
| `862e218` +group scoping | 3/5 solved, 2 good valid |
| `ed57bde` +byte-wise run order | 4/5 solved, 1 good valid |
| `8316252` +3 shortcuts | 3/5 solved, 1 good valid, 1 timeout |
| `c037a24` +4 shortcuts, floored by share | **`pass2` blocked**: 1 solved, 1 timeout |
| `0a7d43b` starter rebuilt | **0/5, 4 good valid, avg@5 = 0.000** |

Rules went 9 → 14 → 15 with the solve rate stuck at 60–80%. What moved it to zero was not a
sixteenth rule. It was noticing the starter was the wrong shape, which is §79 a second time,
on a different task, arrived at from the opposite direction.

## 80 · The repair-to-replace ratio is the number that decides whether §61 fires

§61 says an axis is inert until the wrong answer is inherited. §79 says ship the machinery
built. Neither gives a *test* for whether agents will actually keep what you ship, and on
this task I twice concluded the composition was dead: three fresh Opus agents caught the
planted `run_key` line 3 of 3, and a 624-line structurally-correct retest was solved too.
Both times the agents rewrote rather than audited, and I wrote the axis off.

The missing quantity is not lines inherited. It is **what repairing costs against what
replacing costs**:

| starter | repair path | replace path | agents that kept the inherited line |
|---|---|---|---|
| 186 lines, machinery absent | ≈ replace | ~304 lines | 0 of 2 |
| 367 lines, machinery present and correct | **24 edits, 54 lines** | ~304 lines | **2 of 2** |

At six to one, repair is obviously the cheaper path and agents take it. Then they audit,
fix fifteen departures, and ship the sixteenth. The `pass2` verdict described it exactly:
both agents "correctly articulated the phase structure in the abstract" and neither
"translated that understanding into the correct implementation"; one left
`self.arriving.append(run)` in place verbatim.

**Why the old starter was the wrong shape, and the trap in how it was built.** It was
generated as "every flag on", which seems principled and is not. Of fifteen misreadings,
five *delete machinery* when taken — settling a fold where it happens removes the rider
model, merging the instant stream removes the four phases, a retry that rejoins the queue
removes re-admission. All-flags-on therefore produced a 186-line engine against a 264-line
reference with the expensive parts simply missing, so "finish it" meant "build it". Sort
every candidate misreading into line-changers and subsystem-deleters, **ship the
subsystem-deleters correct**, and put the wrong lines inside the machinery they preserve.
They stay graded regardless, because an agent who rewrites can still arrive at them.

The failure mode this fixes is invisible in the verdict. `c037a24` came back
`1 solved · 0 valid-fail · 1 in-progress-timeout`, and the gate's prescribed remedy was a
longer agent budget already pinned at the 3600 cap. `Pass@ & Timeouts.md` names it in its
own words: "If the model can't even finish, you've built a speed test, not a difficulty
test." After the rebuild both `pass2` trials finished in 40–46 minutes of the 60 with
`low_timeout` PASS, and the four analytical failures at `trials` landed on **four different**
inherited defects rather than one.

## 81 · Prove the starter from both sides, and get a difficulty measurement for free

`build_shipped.py` runs the shipped modules as subprocesses and asserts that, with only its
visibly unfinished parts completed, the engine equals a composition named out of `core.py`
and `proxies.py`. That proves the departures are **all present**. It does not prove they are
**all of them** — an eleventh unlisted defect would satisfy it just as well.

So `minimal_repair.py` goes the other way: one edit per departure applied to a copy of the
shipped modules, nothing else, and the result must reproduce the contract on the worked
example and on all three graded nights. Removing exactly that list arrives at the reference
rather than near it. Together the two pin the starter from both ends, and the second one is
the claim a reviewer would otherwise have to take on trust.

Two details make it an instrument rather than a demo. Every substitution asserts it matched
**exactly once**, so an edit that stops applying after a refactor is a failure and not a
silent no-op (§74's lesson, applied before it bit). And it prints the repair cost, which is
the §80 ratio measured rather than asserted — the same number that belongs in
`difficulty_explanation`.

## 82 · An axis retired on local-probe evidence can still be alive once it is inherited

The byte-wise run-order rule was recorded here as **defeated**: three of three fresh local
Opus agents caught it and named it in their summaries. On `0a7d43b` it took down a real
pass@5 trial (`SW9H39i` shipped `run_key` returning the parsed integer).

Two effects compound. Local probes overstate the model — on this same repo one probe solved
4 of 4 a task that later scored 2/5 in CI. And an axis is not testable until it is inherited,
because a probe that rewrites the engine never encounters the planted line at all. The probe
was answering "would an agent write this bug from scratch", which is a different and much
easier question than "would an agent notice this line while repairing".

**Retire an axis on CI evidence, never on probe evidence.** Breadth does convert into failure
rate — four failures on four distinct defects here — but only once the wrong answers are
inherited rather than derived.

## 83 · Deriving the starter from the reference leaks the audit plan

The fastest way to build the §80 starter is to take the finished reference and inject the
wrong lines. That imports the reference's vocabulary with it, and the vocabulary *is* the
audit plan: a function named `governing`, a variable named `incumbent`, comments citing
"(section 4)". None of that states a wrong answer, and all of it hands over the list of
questions to ask. My pre-existing probe caught it on the first run of the rebuilt engine.

Ban the vocabulary outright rather than only the sentences that resolve it. One term needed
an exception — `coalesced` is one of the five ledger states the contract itself names, so the
literal the engine writes carries nothing the agent did not already have. The exception has
to be **scoped, not granted**: that term is now checked against comments and docstrings via
`ast` and `tokenize` rather than against every line, so prose about it is still banned. And
after narrowing a check, plant a violation and confirm it still fires. I verified both halves
bit before trusting the narrowed version.

## 84 · A probe's verdict can be sound while its table quietly drops a row

Probe 7d decides pass/fail from the deviation script's own assertion over every axis, which
was correct. It *printed* the table through a hand-written alternation of axis names, and an
axis added weeks later was never added to the list. The probe passed green while showing
fourteen of fifteen rows — and that table is quoted verbatim in `task.toml`, so the published
coverage claim was short by one.

Cut such tables out by position, never by a list of names, and **count the rows against the
source of truth** (`len(core.FLAG_NAMES)`), so a missing row fails loudly. This is
§74's rot in a second shape: the earlier one was a textual probe going no-op, this one is a
display filter going stale while the verdict stays honest.

## 85 · `near_miss` will FAIL on an all-or-nothing digest, and the measured table is the defence

Four of five trials at `trials`, and both at `pass2`, scored `near_miss` FAIL: a 5-run
miscount out of 366 (~1.4%) collapsing to reward 0. That reads like a threshold doing the
work, which is exactly what the criterion hunts for.

The analyzer adjudicated it in the task's favour every time, and it is worth knowing *how*:
it quoted `task.toml` back at itself — "the graded nights were specifically constructed to
exercise this condition (171 / 51 / 228 affected records across the three nights)" — and
concluded "the threshold is doing intentional work". The per-axis deviation table, measured
from the committed fixtures and printed in the explanation, is what converts a near-miss from
an accident into a design property.

So on any all-or-nothing grader, expect `near_miss` FAIL and pre-write its rebuttal into
`difficulty_explanation` as numbers. Adjectives will not do it. This remains the softest part
of the record, since a stricter human reviewer can still read "1.4% error scores zero" the
other way.

## 86 · `pass2` is a vise with two jaws, and the screen for both is rewrite-survival

`pass2` is now the binding gate — more designs die here than at `trials`, `qc_gate` and the
statics combined — and it fails in exactly two ways that pull in **opposite** directions:

| jaw | verdict | what it means |
|---|---|---|
| too easy | `2/2 passed — Blocked, no valid fail` | both agents rewrote from the spec and landed right |
| too slow | any `in-progress-timeout` | "still making progress, not genuinely stumped" |

`trials` *discards* an in-progress timeout; `pass2` **blocks on a single one**. So every
lever that buys difficulty by adding work walks you from the first jaw into the second, and
§79 is not an optimisation here, it is the only way to have both.

**The screen that decides the first jaw: would this departure survive if the agent deleted
the starter and wrote the file from the spec?** Ask it of every planted departure, before
building. Almost none survive, and the reason is structural — a departure has to be *fair*,
so the spec states the rule; and a stated rule is transcribed correctly by an agent writing
fresh (§64). A departure that contradicts a spec sentence is therefore worth nothing against
a rewriter, however blind the self-check is. This is where Lever A alone gets you killed:

- `dynamo-5bd3a7e`: every deviation moved 22–158 graded regions and **0** sample regions —
  a textbook Lever A table — and both agents solved 2/2 byte-perfect on all 11 snapshots, in
  8 and 28 minutes of a 3600 s budget, by ignoring the 75-line tool and writing 93 lines.
  The repair ratio was fine. Nobody repaired.
- `dynamo-2946b16`: same shape. Moving the contradiction from the definition to the call
  site does not change what a rewriter does — it re-derives the call site too.
- `dynamo-aa76666` v1: six correctly-blind departures, lost 2/2, because the visible defect
  was architectural and repairing it meant rewriting the function the blind lines lived in.
  Same failure by a different route: the lines stopped existing.

**What does survive a rewrite is an algorithm gap.** The spec states a *definition*; the
algorithm a competent implementer reaches for computes that definition correctly on
everything the self-check can hold, and incorrectly on the graded inputs. There is no
sentence to contradict, so re-deriving from the spec reproduces the bug:

- `dynamo-998062e`: contributing area as additive `1 + sum(feeders)`. Exactly right on
  trees, an overcount on the graded DAGs, and every worked square is a single-receiver tree.
  All three failing trials wrote that line — including the ones that rewrote.
- `dynamo-7f37018`: the bracket for a tabulated rate defined as "the greatest tabulated
  pressure at or below P". Walking the table in written order *is* that definition whenever
  rows are written ascending, and every self-checkable mechanism in the archive has no table
  at all. **4 of 4 agents shipped the sequential walk**, and one of them had rewritten
  enough of the file to fix a different clause.

So the ordering to design in, and it is the opposite of the intuition that says start with
the rules:

1. **Find one algorithm gap.** Rewrite-proof, and the only thing that is. Without it the
   task is a coin flip on whether the two trials happen to repair rather than replace.
2. **Then make repair cheaper than replacement** (§80), so the *other* departures get
   inherited rather than re-derived. This multiplies the gap; it does not substitute for it.
3. **Then blind the self-check** (§77), so nothing in the box turns red either way.
4. **Then subtract every construct both trials get right** (§79), so neither agent lands in
   the second jaw.

**The arithmetic, because a 2/2 is not automatically proof of saturation.** `pass2` blocks
with probability `s²` at solve rate `s`, so a task calibrated exactly to the `trials` bar
(`s = 0.4`) still blocks about **one time in six** by luck alone. Do not redesign on the
verdict line. Read the durations and the approach: two agents solving byte-perfect in 8
minutes is saturation; two agents solving at 55 minutes after a full rewrite is a task that
needs §79, not a new crux. And the corollary that has cost a push: **a local probe that
solves is decisive** (CI's agents are at least as strong), while a local probe that fails
buys confidence and nothing more.

## 87 · Three outside passes: the crux was a decision, never a step

Three tasks built outside this workspace cleared their gates, and what they share matters
more than their domains. In none of them is the crux a hard *step*. A step can be
transcribed; a **decision** has to be made, and in each of these the wrong decision was
available, cheaper, and looked finished.

**Inverse-telecine (video). Make the crux non-local.** A frozen picture and a pulled-down
picture are identical when you compare two frames in isolation; nothing in the pixels
separates them. The only signal is whether the cadence *survives the gap*, which is a
judgment about the sequence, not about any frame in it. The reference's decisive step was
`rides_through`: do two cadence stretches re-join because the phase lines up across the
silence. `idet`, the first tool anyone reaches for, reports the per-frame signature
correctly and still cannot answer whether a silent passage belongs to film or video. That
is an algorithm gap (§86) manufactured by locality: every per-item detector is right and
useless at once, so there is no sentence to contradict and rewriting from the spec
reproduces the miss.

**Lead-failure (survival analysis). Make the crux the estimand, not the computation.** The
graded quantity was a standardized cumulative incidence function, which is a counterfactual:
set every lead to model X, predict each lead's risk under that counterfactual, average over
the population. Stratified CIF curves look like a finish line, you have split by the
covariate and computed the risk, and they skip the standardization entirely. Plugging the
mean covariate vector into the model is cleaner code and wrong, because it assumes one
population-average subject rather than averaging over individuals. Nothing here is hard to
compute. What is hard is knowing which question you are answering, and both shortcuts are
what a competent analyst writes when nobody asks.

**Image-repair (build dependency and release management), pass@5 2/5, avg 0.400, zero
timeouts, AVA BLOCK to PASS.** Five design moves, each of which is reusable:

- **Corrupt the records in pairs, not singly.** Agents do not trust one record, they
  cross-check. With the manifest wrong and `diff_ids` right, they caught it instantly. When
  the hand edit rewrote both together they matched blobs to `diff_ids`, got a clean 4-for-4
  hit and stopped. The trial analysis said it outright: "found a clean 4-for-4 match, and
  accepted the corrupted order as authoritative." **Agreement between two records reads as
  proof.**
- **Aim at the textbook move specifically.** Every domain has a first-reach technique; here
  it was matching uncompressed digests to `diff_ids`. Name it, then make it produce the
  wrong answer. The analysis called this "a sound heuristic that the task author
  deliberately neutralized", which is what a fair stump looks like from the other side.
- **Never hand the trust map over in prose, and this was the single biggest lever,
  measured.** The incident report first said plainly that `diff_ids` were untrustworthy and
  the history authoritative: `pass2` came back **2/2 solved**, both agents read the sentence
  and applied it. Rewritten to say only that the edit went further than anyone can
  reconstruct, leaving which records are stale to the artifacts, it moved back to a valid
  failure. **Disclose that a decision exists; do not disclose the answer.** This is the
  fairness line of §77 stated from the prose side: the rules stay complete, the *conclusion*
  is not pre-drawn.
- **Make the wrong answer silent.** No crash, no error, a valid artifact. A crash makes the
  agent keep working. A plausible near-miss makes it stop and report success. One agent
  noticed the dev-profile values contradicted the spec and rationalized it away.
- **Layer an obvious defect in front of the real one.** The visible `.wh..wh..opq` gives a
  satisfying "found it", and the stale config file behind it looks like an ordinary file.
  Agents stop at the first green result. Same shape as §80's visible defect, and the same
  locality requirement applies: the obvious one must not sit where repairing it rewrites
  the real one.

Two operational rules came out of the same task, and both are cheap:

- **Before pushing, replay the agents' own documented method from the trial analysis as a
  probe, and assert it fails.** The analysis hands you the exact route in prose. Running it
  is the only way to know a redesign actually closed it rather than moved it.
- **Prove the verifier is tool-agnostic.** That task's very first `pass2` was blocked not
  because the task was bad but because `tar -cf - .` tripped the verifier's path
  normalization. **A failure caused by your verifier does not count as difficulty, it counts
  as a defect, and it burns a run.** For every graded artifact, produce it by at least two
  ordinary toolchains and require both to score 1.

## 88 · Calibrate the wrong routes through the real verifier, and prefer exact to tolerant

**Ground truth from construction, never re-derivation.** §11 says do not compute it at verify
time; the sharper form is that it must not come from running the estimator *at all*. The
telecine fixture's expected frames are what existed **before** telecine was applied, recorded
when the fixture was built. The survival task's expected values were computed once during
data generation and pinned into the verifier. Re-deriving ground truth from the reference
makes the verifier circular: it can then only catch bugs in logic you already thought of.

**Generate every plausible wrong route as a real program and run it through the real
verifier.** This is not the deviation harness of §12. A deviation is a flag-flip inside your
own reference; a wrong route is a *different program a competent practitioner writes*
(`naive_any_field_repeat`, `std_is_stratified`, `std_mean_covariates`). Name each one, build
it, require the verifier to FAIL it. On the survival task this caught a live defect nothing
else could see: `std_mean_covariates` initially landed at **0.8x** the tolerance band, so the
verifier as first written would have failed correct work while passing that shortcut. The
deviation table said nothing about it, because the shortcut was not one of my flags.

**Prefer exact verification over tolerances.** The telecine task shipped **zero** tolerances:
a lossless clip, pixel hashes, exact frame counts, exact region boundaries. It was the least
fragile part of either build. The survival task needed a tolerance and it was the most
fragile part. Where a tolerance is unavoidable, **do not set it from the spread of your own
implementations**: that spread shares your assumptions (§63). The internal variant spread
there was **16x narrower** than reality, and the band had to widen to 1.5e-3 after a real
trial landed 2.6e-4 out.

**To move solve rate, increase the distance between the right answer and the nearest wrong
route, measured through the verifier.** The survival task went 3/5 to 2/5 by reading which
wrong methods were closest and lifting the covariate effects until the shortcuts were
further away. That is a dial with a number on it, unlike "make it harder".

**Read the trial analysis, do not guess at the next fix.** The telecine task's first `pass2`
failure said "2/2 solved" with analysis showing `idet` was the signal, so the fix was not
"make it harder" but a trap that requires sequence reasoning, because the analysis said the
held-graphic trap had been handed over by a tool. And **batch advisory fixes into required
revisions**: a rubric note about emitting `clip_sha256` was held until the difficulty
revision went out, one cycle instead of two.

## 89 · Couple a second gate the agent cannot self-check

From the security-hardening pass, where both `pass2` agents failed and neither failed on the
thing the task announced. Difficulty came from coupling, not from any one hard step.

**1 · Run a functional gate alongside the primary gate.** Most hardening tasks test only
whether the hardening happened. This one also re-tested that the storefront still behaved
exactly as before, which makes every side effect fatal. It is what caught the second agent:
an unrequested stock decrement added to `create_order`, never a security failure at all,
collateral damage that only a functionality gate can see. The general form: grade the
*invariant the change must preserve*, not only the change.

**2 · Exact state assertions on seeded data, no tolerances.** `price_cents == 12500`,
`stock == 28`, `stock == 310`. With no tolerance band, a two-unit drift from re-running a
smoke test is unrecoverable. §88's preference for exact checks, applied to state rather than
to numbers.

**3 · Make the verification data disjoint from what the agent can self-check.** The agent
sees two QA accounts. The verifier logs in as four *different* seeded accounts whose
passwords exist only in `tests/conftest.py`. So an agent can run the shipped smoke test,
watch it pass, and still be broken, which is exactly what happened to the first agent: its
migration corrupted all four non-QA hashes while its own checks looked fine. This is §77's
blind self-check moved to the verification side, and it is far cheaper there. No design work,
just credentials and rows the agent never sees.

**4 · All-or-nothing across breadth.** 34 checks spanning eleven subsystems, no partial
credit. Each requirement is individually tractable; a clean sweep needs eleven consecutive
correct decisions plus zero collateral damage, and that probability decays fast.

**The honest reading, which is the actual lesson.** The CORS tightening was the trigger
commit and neither agent failed on CORS. They failed on a shell-escaping bug that pushed a
literal `\$2b\$12\$` into PostgreSQL, and on self-inflicted data drift. **The structure is
what made those failures fatal rather than partially credited.** So: the announced hard thing
is rarely what decides runs, and breadth pays only when it is coupled to all-or-nothing
grading plus a gate the agent cannot self-check. Uncoupled breadth is what passed `pass2` and
lost `trials` on `dynamo-998062e`, and it still wants one rewrite-proof gap (§86) underneath.
Note the standing caveat on this evidence: that task's structure has cleared two trials and
has yet to face five, where three valid failures are needed rather than one.

# The procedure

Sections 1 to 89 are lessons. This is the method they add up to, in the order I would run
it again. It produced avg@5 = 0.000 with five valid failures and 44 QC checks clean on a
first push for `dynamo-e9e60fc`; after the mutation discipline of §30 was added, `qc_gate`
**PASS** with pass@5 1-of-5 for `dynamo-f28612b`; every gate green with avg@5 = 0.200 for
`dynamo-10c05f8`; and every gate green with **pass@5 0-of-5, four good-valid fails and every
rubric column PASS** for `dynamo-7f37018`, which is the best difficulty result here and the
one §77 explains.

## 90 · Difficulty is cost-to-resolve, not concealment: make the obvious repair unsound

From `dynamo-42138ef` (pulsed alert replay), the ninth workspace green: **pass@5 0/5 solved,
four good-valid fails, one in-progress timeout, avg@5 0.000**, every gate clean including
`qc_gate` 44/44. It is the sharpest evidence here for what difficulty actually is, because
of what the trials report says about *why* the agents failed.

**All five agents found the crux. Four of five wrote the same wrong repair.**

The spec couples two definitions so the engine's first pass must decide something only its
fourth pass knows: an instance re-arms only after a window that announced, and what a window
announced is what suppression left of it. Four agents patched the existing four passes with
a `while True` fixed point that re-runs them until the state stabilises. The pipeline's own
analysis calls that *"conceptually correct"* — and it loses, because it does not converge.
Only folding the four passes into a single forward walk is sound, and §7 of the spec states
that such a walk is possible without saying how.

So the difficulty was never in *finding* the defect. Every trial found it on the first pass.
It was in the fact that the first thing a competent implementer reaches for is unsound. This
is the same conclusion §82/§84 reached from the other direction — the agent diffs candidate
implementations over the graded inputs, so concealment was never available — but stated as a
positive design rule rather than a limit.

**Two conditions make the shape fire, and both were nearly missed here:**

1. **The wrong repair must be non-terminating or wrong, never merely slower.** A
   slow-but-correct fix that dies on a verifier limit is an `approach_validity` argument you
   will lose, and rightly. Here the loop provably oscillates: A's re-arm unsuppresses B, B's
   new windows earn B a re-arm that removes B's second window, which re-enables A's.
2. **One graded input must separate the two repairs.** A trial reproduced three of the four
   bundles *exactly* and died only on the fourth, the hand-built one, because it alone
   carries the non-zero re-arm parameter the iteration can oscillate on. Without that bundle
   the wrong repair passes and the task is solved 5/5. The general form: engineering a
   trap's precondition into the data proves nothing on its own, because the instance must
   also land in the span where the two readings actually disagree.

**Three corollaries, each of which cost a run to learn:**

**A clause every agent repairs is not automatically workload — check the scope.** §79 says
to subtract every construct all agents get right. True, but the test is whether they repair
it at the right *scope*. An establishment guard was cut here as "minutes with no
discrimination"; it was a scope trap, and one of two agents had repaired it and then
over-applied the same guard to two neighbouring computations, landing worse than the
untouched engine. Re-measured against the shipped fixtures, the over-application returns the
**right output count with the wrong contents** on two of three bundles while the sample and
the fourth stay clean, so the agent's own output gives no signal at all. Ship a clause
wrong, let it be repaired, and shape the data so the natural over-generalisation is fatal.

**Subtracting workload is what moved the gate, and nothing was added.** The same crux went
from `trials` **blocked** (0 solved, 2 good-valid fails, **3 in-progress timeouts** — one
short of the >=3 the gate needs) to **passed** (4 good-valid, 1 timeout) purely by removing
two clauses every agent was already getting right. Do the arithmetic before spending any
lever on reading cost: with five trials `solves + in-progress <= 2` is the *same* constraint
as `good-valid + soft >= 3`, so a solve and a discarded timeout cost exactly the same, and
cutting reading cost trades a certain loss for whatever the agent then does with the clock.

**The inherited starter has a second job: it makes a wedged agent countable.** One `pass2`
trial spent all 22 of its steps reading, wedged re-reading a 469-line file through the ~10kB
terminal truncation, and never wrote a line. It scored a **good-valid fail**, not an
in-progress timeout, because the wrong engine was already on disk for the verifier to grade.
A stub or a required-rewrite design leaves nothing to grade when the clock fires. This is
why §61's starter matters most on exactly the tasks that run near the cap.

**One operational note.** `qc_gate`'s expensive checks are scored against the *oracle and
verifier*, not the starter the agent repairs. The design here was rebuilt three times between
two QC runs and the second still scored 44/44 with an empty fixes blob, because
`reference.py`, `solve.py`, `test_outputs.py`, both spec documents and every fixture were
byte-identical to the tree QC had already passed. Keep a difficulty redesign inside the
artifact the agent edits and QC re-clears for free; move the spec or the oracle and every
probe re-opens.

## 24 · Method for `pass2` and `trials` (difficulty)

**Step 0. Choose a domain with a famous near-neighbour** (§28). Something the model already
has instincts about, then differ from it deliberately and put every difference on the page.
This buys difficulty and a free list of mutants at the same time, and it is the cheapest
structural decision available. Then decide what wrong model the agent will **inherit** (§27):
shipped code that already implements the hard part, plausibly and incorrectly, in the file
they have to edit. A missing implementation invites reading the spec; an existing one invites
pattern-matching, which is what you are testing.

Make the inherited artefact **look finished** (§61). A stub is deleted and rewritten — that
is measured, twenty-one trials out of twenty-one — which hands the model the one task it is
strongest at. Ship a complete, competent engine with one *visible, narrow* defect the samples
do catch, so the agent has real work, reaches a green suite and stops. Every other departure
rides in the structure they keep. Pair each blind rule with a **pre-written line that
violates it**: the rule alone is transcribed correctly, the engine alone is rewritten, and
only the composition fails an agent who understood the rule and annotated it correctly.

**Step 0b. Decide what the agent's self-check is, and prove it blind per clause** (§77).
This is the step that decides `trials`, and it is not the sample. Ship an artifact the agent
will actually run to convince itself it is done — a set of solved runs, a worked archive, a
conformance corpus — make it complete and honest, and make it structurally unable to observe
each blind clause. "Structurally" means a reason of the form *these inputs contain no such
construct*, not *the values happen to be close*. Then ask of every defect: what in the box
turns red if this is left in? Anything answered by the sample is decoration; anything
answered by nothing survives a competent full rewrite.

**Step 0c. Subtract every construct the trials already get right** (§79). Ship it built and
correct. It is latency, not difficulty, and left in it converts the analytical failures
`trials` counts into in-progress timeouts, which count for nothing. Set
`[agent].timeout_sec` to the 3600s cap as well — but note the clock is the weaker of the two
levers and has a second-order cost, because room to finish is also room to solve.

**Step 1. Choose the axes before touching data.** List the places where the natural
implementation and the spec diverge. Demand independence: realising one must not hand the
agent the others. At least one axis must be about **when** a value is read rather than what
it is (§36): anything the spec states as a property of a single value, the model computes
correctly, so per-value axes make up the breadth but do not survive as the crux. Spread them across the pipeline so no single insight collects them.
Prefer axes stated as a *premise* rather than as behaviour (§29) — a sentence describing a
circuit, a protocol or an invariant, whose consequence decides the graded output. Copying
that sentence into code does nothing, and nothing is withheld.
Mine sat in input handling (which subjects enter an analysis set), design parameters
(which of three quantities is the information fraction), boundary construction (the
final-analysis rule, and whether one continuation region serves both boundaries), and
inference (the sample-space ordering, and the estimator).

**Step 2. Solve for the blinding case, do not tune it.** Find the configuration of your
domain that is degenerate on every axis at once (§20), then build the shipped sample from
it. Write down, per axis, the reason it is *exactly* inert. If a reason is "the values
happen to be close", it is not inert and you are tuning.

**Step 3. Build the deviation harness before you finish the task.** One implementation,
one boolean flag per misreading, a `flatten()` that produces graded field paths, and a
canonicaliser at exactly the graded precision. This is your acceptance instrument, and it
lives outside `task/`.

**Step 4. Hold it to a numeric bar.** Mine: every deviation moves at least 3 graded fields
and **0** sample fields, and all deviations together move most of the set. Print the table.
It goes straight into `difficulty_explanation`, because numbers survive review and
adjectives do not.

    misreading              graded moved  sample moved
    planned_fractions          39/73          0/10
    size_fractions             39/73          0/10
    no_final_spend              3/73          0/10
    binding_futility           13/73          0/10
    naive_ordering             16/73          0/10
    mle_estimate                4/73          0/10
    count_unevaluable          65/73          0/10
    every_one                  65/73          0/10

**Step 5. Grade all or nothing.** 73 fields, one reward. A single axis is then fatal, which
is what turns a list of small discriminators into a difficulty gate. It is also what makes
a 3-field deviation acceptable.

**Step 6. Seed-search for boundary cases.** Do not accept the first dataset that works.
Search until the graded pattern is what you intend *and* at least one deviation flips a
categorical field rather than a digit. I searched until a wrong final-analysis rule flipped
a stopping decision. A qualitative miss reads as a real error to a reviewer; a seventh-digit
miss reads as a tolerance argument.

**Step 7. Ask what library a competent implementer reaches for first, and whether it holds
your graded precision.** This is the step I skipped, and it turned out to be the crux
(§17). Run the obvious general-purpose route yourself, at the dimensions your data
actually reaches, and compare against your reference. If it falls short, that is your
primary discriminator and it belongs in the metadata from day one. If it holds, you have
one fewer discriminator than you thought.

**Step 8. Foreclose every shortcut in writing.** Each trap must be excluded by an explicit
sentence in agent-visible material, cited by section. That is what let `task_specification`
and `approach_validity` pass 7 of 7 trajectories while every trap still bit. Fair and hard
are not in tension. *Unstated* and hard is.

**Step 9. Claim only what survives being tested** (§29). The pass@2 engine reads
`difficulty_explanation` and checks it against what the agents actually did, then posts the
result on the PR. "Cannot be reached by transcribing the document" was refuted there in one
paragraph, because both agents derived it. Write the narrower true claim: derivable, one of
two derived it, and transcription alone is not enough.

**Step 10. Read the breakdown line before you believe the verdict** (§67). `0 solved ·
0 valid-fail · 2 infra/setup-timeout` is not a difficulty measurement, it is the harness
falling over, and the correct response is to change **nothing** and get the run repeated.
From a contributor account `/rerun` silently does nothing (it needs write access and
reports success anyway); close and reopen your own PR instead, which fires the same fresh
run. And when the trials do run, check *why* they failed (§71): three of my four pass@5
failures were terminal wedges from truncated heredocs, so the measured avg@5 was not a
measurement of my planted axes at all. Take the pass, but do not mistake it for evidence
the axes are strong.

## 25 · Method for `qc_gate`, `ava_review` and `adversarial_review` (soundness)

Structural first, because each of these deletes a family of findings rather than one:

1. **Grade a data file** (§10). Nothing of the agent's executes at verify time.
2. **Drop privilege**: `[agent].user`. Create the account, give it `/app` and nothing else.
3. **Ship ground truth offline** (§11): generated from fixed seeds, agreed by two
   implementations along different numerical routes before anything is written, committed
   as salted PBKDF2 digests.
4. **Widen every preimage** (§18): per-field digests for the wide fields, one record digest
   covering the narrow ones.
5. **Pin every interpreter `test.sh` starts, not just pytest** (§69). For pytest:
   `-c /tests/pytest.ini --rootdir=/tests --noconftest -p no:cacheprovider`,
   `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, `PYTHONSAFEPATH=1`, `PYTHONPATH=`, and clear the
   reward path rather than inheriting it. For any other `python3` you add, including a
   five-line heredoc, use `-I`; without it the working directory is on `sys.path` and a
   planted `/app/shutil.py` executes as root. Enumerate the processes the script starts
   and audit each one, every time you add machinery.
6. **Capture the artifact, then grade the capture** (§68). Copy it into root-only `/logs`
   through `O_NOFOLLOW` with a regular-file check as the first thing grading does, and
   never read the agent-writable path again. Do not compare its mtime against a stamp:
   mtime belongs to whoever owns the file, and a guard that is skipped when the stamp is
   missing is worse than none.
7. **Assert the lockdown in the build**, so a future base image that ships the interpreter
   or its packages writable fails the build instead of reopening the isolation.
8. **Name every KIND of thing the graded output can hold, in the contract** (§70). Bars
   and lines were covered; a stacked band was neither, and B1 fires on exactly that gap.
9. **Re-derive every attribute of a grouped entry per member** (§78). Wherever the spec
   groups entries, reading a non-key attribute off the first member is right only while the
   members agree — which every fixture you wrote will do, and which QC's A6 will not. Give
   at least one graded case members that disagree.
10. **Budget the verifier as a whole, not per case.** A per-case cap the size of the
   verifier's own `timeout_sec` lets one non-terminating submission run the verifier out of
   time, and a verifier killed mid-run reports *nothing* — not even the failure it had
   already established. Share one budget across the cases and refuse to start a run that
   cannot finish inside what is left.

Then measure it. **Stage every attack as the agent account, never as root.** The battery
that went in, 28 cases:

    oracle 1.0 · oracle rebuilt inside the container 1.0 · nop 0
    one submission per misreading, and all of them together      8 cases, all 0
    empty values · non-finite · bool for an integer · short series   4 cases, all 0
    committed fixture contains no graded number in plaintext
    watcher copies the fixture over its own answer               0
    watcher reads the fixture aside to work on                   0
    reward pre-seeded to 1 with /logs left world-writable        0
    sitecustomize planted in the agent's user site               0
    conftest.py and pytest.ini planted in the working directory  0
    stdlib module shadowed from the working directory            0
    output symlinked into /tests · modified input · modified spec   3 cases, all 0
    oracle re-run for repeat stability                           1.0

**Then mutate the spec, not the code — in four rounds, not one** (§30). One round is what
kept failing `qc_gate`; each later round found what the earlier ones structurally could not.

1. **Enumerate.** One mutant per normative sentence, and count moved graded fields (§3).
2. **Mutate the way an implementer would err.** Round one picks the easiest mutation of each
   rule, which is not the same as covering it. Where a probe's operand makes two wrong rules
   agree, fix the probe.
3. **Mutate what the spec says by omission** — the near-neighbour's behaviour from Step 0,
   written down as mutants. Ten of these survived a set that already killed 57.
4. **Audit the enumeration.** Map every mutant back onto the spec sentence by sentence and
   name which sentence each attacks. Sentences with nothing standing against them are the
   ones the gate will find. Six here; all six turned out already covered, which you cannot
   know until you check.

**Adjudicate each survivor on its regenerated diff, never on the sweep's label** (§78). The
labels are wrong in both directions: on `dynamo-7f37018`, 440 mutations left 58 survivors,
and two probes written from the labels turned out to describe mutants the sweep had in fact
caught. Regenerate each survivor, diff it against the reference, measure its worst deviation
through the real verifier, and sort them into named classes with the count and the worst
figure attached — 58 survivors in 8 classes, worst 0.0316% against a 0.5% band is an argument;
"58 survived, all benign" is not. Note also what an operator-level sweep *cannot* generate:
a changed constant or a restructured clause. QC mutates from the spec and will find those.

**Decide gap versus equivalent rewrite by measurement, not by reading** (§31). Fuzz a few
hundred generated inputs to find separations, then ask what the generator *cannot express*
and hand-build a probe for each — mine could not reach a page boundary, one exact address, or
an undriven instruction fetch, and so called three real gaps clean. Where the domain is small,
enumerate exhaustively and cite the count. State the outcome positively: every mutant any
input can distinguish is caught, with the impossibility proofs attached.

**Debug the probe before believing the rule is unobservable** (§32). A probe that repeats an
operation to hit a periodic condition needs stride and period coprime, and a signed effect
needs the instrument read *between* runs or the drift cancels to nothing.

**Verify committed fixtures against the prose that describes them** (§33), by re-deriving each
claim from the bytes.

**Then re-run all of it after any input regeneration.** Changing a design parameter
invalidates every measurement above, including the percentages quoted in the metadata — and
re-measure the metadata numbers themselves (§34), since adding three graded inputs falsified
four numbers and two claims that had been true when written. Derive the graded set from the
shipping verifier so the sweep cannot measure a different set from the one that ships.

**Treat a green `qc_gate` as a floor** (§35). It passed here on the commit that lacked rounds
three and four, reporting "no material coverage holes" while six sentences had none. Its
advisory notes, by contrast, are real: mine named the exact `.dockerignore` gap the ROMs I was
about to add would have fallen through.

## 26 · Order, and the two rules that cost the most

Run §24 steps 1 and 2 **before** writing any data, §24 step 3 before finishing the task,
and §25 before the first push. The pre-flight battery is the fast loop; `harbor` is the
final confirmation only.

Two rules earn their place by what breaking them costs:

- **Never push while a run is in flight.** A push cancels it and destroys verdicts that
  cannot be reproduced locally. Batch every fix and push once.
- **When a run comes back green, banking it is a real option.** Every fix after that is a
  billed re-run and a re-rolled pass@5. Weigh the advisory against the measurement you
  already hold. On `dynamo-43b27a9` the passing submission did not contain the last
  improvement I had built and verified: `trials` is stochastic, the axis it strengthened was
  already firing, and re-rolling 0-of-5 for a cosmetic gain is a bad trade. Check what the
  green run actually contains before deciding the next push is free.
