# What to push, and what to leave alone

Draft `Iyqs0O4Gt2d1A2SMIabO`
(https://experts.afterquery.com/projects/gold/tasks/Iyqs0O4Gt2d1A2SMIabO).

`gold_bot.py push` sends only the bundle files that exist under the directory it
is given, and prints the rest as "left as-is on the platform". So the push
directory holds exactly the five files this task owns.

## Push these six

| file | bytes | what it is |
| --- | --- | --- |
| `instruction.md` | 1843 | 297 words, ends with the commit line |
| `solution/solution.patch` | 28790 | reference solution, +630/-60 over 14 files |
| `tests/test.patch` | 29258 | the two held-out files, +740 over 2 files |
| `tests/config.json` | 24474 | 36 f2p ids, 184 p2p ids, junit grading |
| `tests/test.sh` | 26432 | the frozen frame with our block between the markers |
| `task.toml` | pulled | only `display_title` and `display_description` rewritten |

Staged at `result/biomeweaver-prey/push/`, task.toml once the draft is pulled.

### The two display fields

They live in `task.toml`, and they are the only part of that file we may write:

```
display_title = "Ration contested prey between the predators that hunt it"

display_description = "Predation is settled one predator cohort at a time off a
running prey count, so the first cohort in sort order empties a contested prey
cohort and every later one goes without. Settle a whole tick together: asks read
before anything moves, an authored per-species intake cap, an optional
saturation on a rule, and prey shared out in proportion round by round until a
round moves nothing."
```

(one line each in the file; wrapped here to read).

`set_display.py` takes the pulled `task.toml`, rewrites those two lines and
nothing else, and refuses to write at all if a third line moved. That is the
defence against what killed four configlayer drafts: a `task.toml` rebuilt by
hand wipes the generated frame and fails every toml rule at once. So `task.toml`
can only be staged after the draft is pulled, which is why it is not in `push/`
yet.

## Never push these five

`pre_artifacts.sh`, `environment/Dockerfile`, `solution/solve.sh`,
`tests/Dockerfile` and `tests/grader.py` are written by the platform when the
draft is created, and nothing here has any business changing them. `grader.py`
is checked byte for byte at submission. They stay out of `push/` on purpose, and
`gold_bot.py push` leaves anything absent exactly as it stands on the draft.

## Before the push, two things still need the platform

1. **The base commit.** `tests/config.json` carries forty zeros right now. The
   real hash lives on the draft (`task.toml`'s `base_commit_hash`), and
   `grader.py` resets files to it before applying either patch, so a wrong value
   breaks the run. There is no way to derive it from the snapshot: it ships
   without a `.git`.
2. **The frame.** `tests/test.sh` is currently spliced into the seat's
   `original_test.sh`. Both frames seen on this seat differ only inside the
   marked block, so the generated file is very probably already byte-correct,
   but the draft's own frame is the only one that proves it. `mktestsh.py`
   re-splices and asserts every byte outside the markers is unchanged.

`prepare_push.sh` does both, re-verifies in a container, restages, and prints
the push command:

```sh
cd result/biomeweaver-prey
./prepare_push.sh          # pull, splice, verify, stage
./prepare_push.sh --push   # the same, then push
```

Either form needs the platform to answer. Everything else about the task is
finished and verified offline.
