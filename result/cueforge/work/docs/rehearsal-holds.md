# Rehearsal holds, worked through

`docs/timing-contract.md` states the rules. This page walks one production
through them so the numbers can be checked by hand. Every value below comes
from `cueforge rehearse examples/holds/shared_wall.yaml --format json`.

## The plan

`shared_wall` has one video wall with a single slot and a haze rig with two.
Three video cues want the wall:

| cue | called | duration | uses |
|---|---|---|---|
| `vid_intro` | 0 | 5000 | wall |
| `vid_verse` | 2000 | 4000 | wall |
| `vid_bridge` | 5000 | 1000 | wall |

`compile` reports `CF4001` for the wall: the plan books `vid_verse` over
`vid_intro`, and `vid_bridge` over both. The compiled plan is still returned;
the rehearsal is where the holds resolve it.

## What the rehearsal does

At 0 `vid_intro` starts and holds the wall until 5000.

At 2000 `vid_verse` is called. The wall has one slot and one holder, so there
is no free slot: `vid_verse` holds. It holds nothing while it waits.

At 5000 two things happen at one instant. `vid_bridge` is called, and
`vid_intro` completes. Reservations are half-open, so the release at 5000
frees the slot for a cue called at 5000. Two cues could take that one slot:
`vid_verse`, planned at 2000, and `vid_bridge`, planned at 5000. The earlier
planned instant wins, so `vid_verse` starts at 5000 and runs to 9000, and
`vid_bridge` holds.

At 9000 `vid_verse` completes and `vid_bridge` starts, 4000 ms late.

| cue | planned | started | held |
|---|---|---|---|
| `vid_verse` | 2000 | 5000 | 3000 |
| `vid_bridge` | 5000 | 9000 | 4000 |

Both appear in `holds`, ordered by planned instant, and each carries one
`CF7001` warning:

```json
{"cue_id":"vid_verse","held_ms":3000,"planned_ms":2000,"resources":["wall"],"start_ms":5000}
{"cue_id":"vid_bridge","held_ms":4000,"planned_ms":5000,"resources":["wall"],"start_ms":9000}
```

The witness on the finding carries the same numbers, with `resources` as the
comma-joined string `wall`.

## Dependents

`lx_chase` is `after: vid_verse, offset: 250`. Its offset is not negative, so
it is called from the actual start of `vid_verse`: 5000 + 250 = 5250, not the
2250 the plan gave it. It never starts before its dependency.

`lx_pre` is `after: vid_verse, offset: -500`. A negative offset cannot wait
for an instant nobody knows yet, so `lx_pre` keeps its planned instant and
starts at 1500, well before `vid_verse` actually starts at 5000. That is what
happens on a real stage: the pre-verse look was already up when the wall
turned out to be busy.

The assertion `vid_verse.started before lx_chase.started` holds (5000 before
5250). `vid_intro.completed before vid_bridge.started` holds too (5000 before
9000), and would also have held without the hold.

## Capacity above one

The haze rig has two slots. `haze_a` (called at 100) and `haze_b` (called at
200) take both. `haze_c` is called at 300, finds no free slot, and holds until
`haze_a` releases at 3100. It starts then, 2800 ms late, and its `resources`
lists only `haze`. The rig never reports `CF4002` from the rehearsal, because
a third holder never exists.

## Ties and order

When several cues are holding for the same slot, the order they get it is
the order of their planned instants, and cue id breaks ties. The planned
instant of a dependent with a non-negative offset is the instant it was
called, which is later than the plan said whenever its dependency was held.
A cue that arrives at the release instant, like `vid_bridge` above, is
behind every cue that has been waiting longer.

## Failures

A holder that fails while running releases its slots at the failure instant,
and cues waiting for those slots start then. A cue that fails before it
starts, at its planned instant or while holding, never held a slot and
releases nothing; its dependents with non-negative offsets are called from
the failure instant, exactly as they would be from a start.

A held cue's `requires` states are checked when it actually starts, not when
it was called. A cue called while the revolve is `locked`, held, and started
after another cue moved the revolve, fails with `CF4003` at its actual start.

## Exit codes

`CF7001` is a warning. A rehearsal whose only findings are holds has no
errors, so `rehearse` and `report` exit `0` for it, while `compile` on the
same production still exits `1` for the plan-level conflict.

## A hold that ends in a state failure

`examples/holds/revolve_late.yaml` puts the state check where it belongs, at
the actual start. `scene_change` is called at 1000 and needs the winch, which
`fly_in` holds until 6000, so it holds. At 3000 `safety_unlock` moves the
revolve from `locked` to `unlocked`. At 6000 the winch frees and
`scene_change` starts, or rather tries to: its `requires` says the revolve
must be `locked`, it is not, and the cue fails with `CF4003` at 6000. It
never held the winch or the revolve, so nothing is released, and there is
no `CF7001` for it: a hold is reported for a cue that started late, not for
one that never started.

`cleanup` is `after: scene_change, offset: 500`. Its dependency failed before
starting, at 6000, so `cleanup` is called from that instant: 6500. It finds
the revolve free and runs. `intro_vo`, with `offset: -300`, keeps its planned
instant of 700 and runs long before any of this.

```
$ cueforge rehearse examples/holds/revolve_late.yaml
rehearse revolve_late digest=...
events=21
  fly_in completed start=0 end=6000
  safety_unlock completed start=3000 end=3100
  scene_change failed start=None end=None
  cleanup completed start=6500 end=7300
  intro_vo completed start=700 end=1900
findings:
  ERROR CF4003 cue:scene_change: cue 'scene_change' failed at 6000ms
  ERROR CF4003 resource:revolve: cue 'scene_change' requires revolve.locked but current state is unlocked
```

The command exits `1`: the failure is an error, and only holds are free of
errors.

`scripts/verify_holds.py` rehearses both examples and checks the invariants
every hold must satisfy: no resource ever has more holders than slots, every
recorded start is at or after its planned instant, and the `holds` list is
ordered the way the contract says.

## Reading a hold in the JSON report

| key | meaning |
|---|---|
| `cue_id` | the cue that started late |
| `planned_ms` | the instant it was called |
| `start_ms` | the instant it actually started |
| `held_ms` | `start_ms - planned_ms`, always positive |
| `resources` | the resources that had no free slot when it was called, sorted |

The same numbers sit on the `CF7001` finding as `witness`, with `resources`
joined by commas because a witness value is a scalar. A cue that started when
it was called never appears in either place, whichever slots it waited for
at the same instant.
