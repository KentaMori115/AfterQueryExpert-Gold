# chained runs

A rack can be chain fused. One electric match goes on the first tube and a
length of quickmatch runs down the rest, so the panel closes one circuit and
the fire counts the rest of the run out at the rate the fuse was cut for.
Crews do this by hand on any show where the rig is short of outputs, and
before this the script had no way to say so: every shell in a run took a
pin, and `check` would refuse a finale that fitted the field with room to
spare.

## writing it

`chained` is a clause on `ripple` and `fan`, and only on those two, because
a chain is one run from one position.

```
at 18.0  ripple 6 of shell.75.peony.red from pad.a every 400ms chained
at 64.0  fan 7 of shell.75.crossette from pad.b spread 1.6s chained pin 2.05
```

The clause goes anywhere among the others and `fmt` writes it back last.
Three things are refused rather than quietly reinterpreted, since a shooter
who wrote the word expects one pin and would otherwise find the run spread
across a dozen:

- `chained` on a `fire` or a `chase`. A single shot has nothing to chain,
  and a chase runs across positions that no fuse joins.
- `chained` beside `jitter`. Quickmatch burns at one rate.
- a chained run longer than `MAX_CHAIN_LENGTH`, or one with no interval to
  cut a fuse for. Both produce no shots; the rest of the script compiles.

A `pin` clause on a chained run fixes the head's pin, and only the head's.
It is claimed before any automatic pin the way a fixed pin on a `fire` is,
so an earlier cue cannot take it, and two runs naming one pin are refused.

## what the compiler makes of it

Every shot of the run is still a shell in a mortar and still goes up, so the
expansion keeps one shot per shell and the schedule keeps one event per
shot. What changes is where they sit and how they are timed:

|            | unchained run                 | chained run                                     |
| ---------- | ----------------------------- | ----------------------------------------------- |
| address    | one pin per shot              | the head's pin on every shot                    |
| `fuse`     | absent                        | burn from the head's ignition, zero on the head |
| ignition   | cue time less the lead        | head's ignition plus the fuse                   |
| quantised  | every shot snapped to a frame | the head snapped, the rest moved with it        |
| drift      | each its own                  | the head's, reported on every shot              |
| pins taken | one per shot                  | one                                             |

The head takes a pin the way any single shot would, so a run on a position
with three modules takes one turn of the round robin, not six. A statement
inside a group that is played twice expands into two runs on two pins.

Only the head lands on the panel's clock. A follower is timed by the fuse,
not by the frame, so it moves exactly as far as its head moved and reports
the head's drift as its own. Snapping it separately would put it on a frame
the fire will not be on, and a run with a tight interval would then trip
the collapsed-frame warning for a collapse that cannot happen.

## one cue, many shots

Everything downstream follows one rule. A chained run is one cue and many
shots, and each consumer decides which of those it is counting.

Seen from the panel and the field, it is one cue:

- the firing table has one row for it, on the head's address, numbered
  with the rest, and `explain` finds cue numbers the same way;
- the module load counts one pulse, since a follower draws nothing;
- the rehearsal plan expects one light on the module;
- the wiring sheet lists one lead, and the pin count on the rack layout and
  in `moduleLoads` counts one pin;
- a diff compares head to head, and a chain that gained or lost a tube or
  was cut to another interval is reported as a swap on its pin, because the
  fuse has to be re-cut on the field;
- a doubling plan backs the run up once, on the head. The shots down the
  fuse have no match of their own to double.

Seen from the sky and the paperwork, it is every shot:

- the density and the lulls, since every shell is lit;
- the separation, airspace and fallout checks, per shell as before;
- the inventory, the hazard totals and the transport lines;
- the rack layout's tubes and the tube hire order, since every shell needs
  a mortar;
- the permit's `shotCount`, which now parts company with its `cueCount`.

`chainCandidates` and the PF3500 note only ever look at runs that are not
chained yet, so a run the script already fuses is not suggested again.

## a worked run

Three modules stand at `pad.a`, and the script says

```
at 10.0  ripple 6 of shell.75.peony.red from pad.a every 250ms chained
at 20.0  fire shell.75.peony.red from pad.a
```

A three inch shell climbs for about two and a half seconds, so the head
fires at 7.56s to break at 10.0s. On a twenty five frame clock 7.56s is not
a frame boundary; the head moves ten milliseconds early to 7.55s, and the
whole run moves with it:

| shot     | fuse | fires | breaks | drift | pin   |
| -------- | ---- | ----- | ------ | ----- | ----- |
| 1 (head) | 0    | 7.550 | 9.990  | -10   | 01.01 |
| 2        | 250  | 7.800 | 10.240 | -10   | 01.01 |
| 3        | 500  | 8.050 | 10.490 | -10   | 01.01 |
| 4        | 750  | 8.300 | 10.740 | -10   | 01.01 |
| 5        | 1000 | 8.550 | 10.990 | -10   | 01.01 |
| 6        | 1250 | 8.800 | 11.240 | -10   | 01.01 |

Shots two to six sit ten milliseconds off the frame grid, which is right:
the panel never fires them, the fuse does. The single shell at 20.0s then
lands on module two, because the run took one turn of the round robin at
`pad.a`, not six. The firing table has two rows, the module load shows one
output on module one and one on module two, and the crew cuts 0.63m of
quickmatch for a 250ms interval at `FUSE_MS_PER_METRE`.

## on the field

The pin list, the wiring sheet and the firing table's note column all say
what a chained output lights, in the form `chain of 6, 400ms apart`, and
`explain` on any shot of the run says which tube it is and how far down the
fuse it sits, in milliseconds and in metres of quickmatch at
`FUSE_MS_PER_METRE`. The crew cuts the fuse from that figure.
