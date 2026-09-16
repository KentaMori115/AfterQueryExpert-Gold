# Building history

Commits must be dated across multiple days instead of all landing today, and
every commit must be a state the repo can be checked out at, built and tested —
a later task's base commit is chosen from the middle of this history, not from
the tip.

Do NOT rewrite history that has already been published or submitted. Everything
below is for a repo that has not been submitted yet.

## Default: commit as the work happens

Land each coherent slice as its own commit at the moment it is finished and its
tests are green, choosing that commit's timestamp as you make it. This is the
approach `create-repo` describes; prefer it whenever the repo is being built now.

Slices are the units of real work: a contract landing in `docs/`, a package plus
its unit tests, fixtures with the code that reads them, the CI workflow (early,
not last). Not only additive work either — a defect introduced in an
ordinary-looking commit and repaired later, and a slow implementation later
replaced by a faster one, are what give the repo bases for defect-fix and
performance tasks rather than feature tasks alone.

Commit messages read like real work, and name neither the platform, the vendor,
nor this authoring workflow.

## Recovery: history for a tree that is already built

Only when the code already exists as one undifferentiated tree.

Start from a clean tree. Decide N logical commits (e.g. format/reader → section
decoders → pipeline → util library/tests/README/seeds), one coherent slice each.
Pick N timestamps inside the window below, each **strictly later** than the one
before it — not merely no earlier — at realistic times of day. For each commit,
stage only that slice's files and commit it.

Know what this costs: slices carved out of a finished tree were never built or
tested in isolation, so an intermediate commit may not compile and cannot be
trusted as a base until proven. Check out each one into a worktree and build and
test it before treating it as a candidate — and expect a retrofitted history to
be purely additive, which limits the repo to feature-shaped gaps.

## Choosing the window

The history sits **1–4 months before today**, derived from today's date rather
than a pasted literal. Inside that band, build **55–75 commits spanning 3–5
weeks**. The platform floor is lower — more than 50 commits over two weeks — so
these targets clear it with margin rather than sitting on the line.

Nothing in a commit may postdate it. A tree dated 2024 cannot declare Python 3.14
(October 2025) or `go 1.24` (February 2025), pin a CI action major that had not
shipped, or use a base image tag that did not exist yet — and that is checkable
by reading any manifest against the date beside the commit. If the stack and the
window disagree, move the window later inside the band first; only failing that,
use the version that was current at those dates.

## Mechanics, either way

Set BOTH date variables on every commit. Setting only one leaves the committer
date at today, which is what the remote displays:

```bash
GIT_AUTHOR_DATE="@<epoch> +0000" GIT_COMMITTER_DATE="@<epoch> +0000" \
  git -C <PATH> commit -m "<msg>"
```

Draw the epochs from a pool generated once (see `create-repo` for the generator),
never by hand and never by walking a fixed gap. The pool must satisfy:

- **weekdays only** — no Saturday or Sunday commits;
- **an uneven weekday histogram** — equal counts Mon–Fri is a machine's
  signature; weight the days differently and leave some workdays empty;
- **one commit per second at most, with varied seconds** — repeats, or every
  seconds field reading `00`, are the plainest evidence of a scripted backdate;
- **strictly increasing**, inside working hours;
- **55–75 stamps spanning 3–5 weeks**, fixed before the first commit rather than
  discovered afterwards.

Then confirm: monotonic in both dates, no shared second, seconds spread, no
weekend, weekdays uneven.

```bash
git -C <PATH> log --pretty='%h %ad %cd' --date=iso
git -C <PATH> log --format=%at | sort | uniq -d                     # must print nothing
git -C <PATH> log --format=%ad --date=format:%S | sort -u | wc -l   # not 1
git -C <PATH> log --format=%ad --date=format:%u | sort | uniq -c    # no 6/7; 1-5 uneven
```

To insert a commit early in an existing history,
`git rebase --committer-date-is-author-date`.

Push, then verify on the remote that the dates render as intended.

The reflog needs no special handling. `git commit` writes its entry with
`GIT_COMMITTER_DATE`, so commit entries are backdated too; `checkout`, `reset`,
`branch` and `merge` stamp real wall-clock time. Either way `.git/logs` is local
— it is not pushed and a clone does not carry it. Only when the working tree is
handed over as a directory does it reveal the real session, and then
`git -C <PATH> reflog expire --expire=now --all && git -C <PATH> gc --prune=now`
clears it without touching the commits.
