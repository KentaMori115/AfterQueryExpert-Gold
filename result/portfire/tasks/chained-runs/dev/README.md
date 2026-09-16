# portfire

Firing scripts, cue timing and separation distances for computer fired
pyrotechnic displays.

A portfire is the slow match a shooter holds to the fuse. This is the same job
done by a firing panel, and the part that goes wrong is never the ignition, it
is the arithmetic in front of it. A six inch shell spends about four seconds
getting to its break. Fire it on the beat and it breaks late.

## what it does

Takes a display written as a cue script, resolves it against an effect catalog
and a physical firing rig, compensates every cue for time of flight so the
break lands on the beat, checks the result against separation distance and
airspace rules, simulates the current each rail will draw, and emits the firing
table the panel actually loads.

```
show autumn-2025
seed autumn-2025
frame 25

at 4.0   fire shell.200.brocade from pad.far label opener
at 18.0  ripple 6 of shell.75.peony.red from pad.a every 400ms
at 43.0  chase shell.75.peony.red across pad.a pad.b pad.c every 300ms
at 92.0  play finale
```

```
portfire check show.pf --catalog house.csv --rig autumn.rig --audience 200
portfire table show.pf --catalog house.csv --rig autumn.rig --out panel.csv
portfire pack  show.pf --catalog house.csv --rig autumn.rig --audience 200
```

A worked example lives in `examples/autumn`.

## chaining a rack

A rack can be chain fused: one match on the first tube and a length of
quickmatch down the rest, so the panel closes one circuit and the fire does
the counting. Write `chained` on a ripple or a fan and the whole run comes
off one output.

```
at 18.0  ripple 6 of shell.75.peony.red from pad.a every 400ms chained
at 64.0  fan 7 of shell.75.crossette from pad.b spread 1.6s chained pin 2.05
```

The rules that follow from that are the physical ones. The run holds one pin,
so a `pin` clause on it names the head's pin and nothing else. Quickmatch
burns at one rate, so a chained run cannot `jitter`, and a chase cannot be
chained because no fuse runs between positions. The far end of a long chain
often does not light, so a run past twenty four shots is refused rather than
fired on hope. And the panel only ever fires the head, so only the head is
snapped onto the frame clock; every shot after it goes when the fire reaches
it, which is the head's ignition plus its fuse, whatever the clock says.

Everything downstream keeps to one rule: a chained run is one cue and many
shots. The firing table, the module load, the rehearsal plan, the wiring
sheet, the pin count, the diff and the doubling plan see the head alone. The
density, the safety checks, the inventory, the rack layout, the hazard
figures and the permit's shot count see every shell that goes up.
`portfire explain` on the head says how many tubes it lights, and on any
other shot of the run says how far down the fuse it sits.

## the commands

| command                        | what it answers                                |
| ------------------------------ | ---------------------------------------------- |
| `check`                        | is anything wrong with this show               |
| `table`                        | what goes on the panel's memory card           |
| `sheet`                        | what the crew carries onto the field           |
| `layout`                       | how many racks and tubes, and where they stand |
| `plan`                         | where everything is, drawn                     |
| `preview`                      | what shape the show is                         |
| `explain`                      | why does this one cue fire when it does        |
| `diff`                         | what changed since the version we wired to     |
| `inventory`                    | what it consumes and what we are short of      |
| `hazard`                       | net explosive quantity and hazard division     |
| `permit`                       | the facts a licensing authority asks for       |
| `crowd`                        | how many people the viewing area holds         |
| `continuity`                   | does the field match the show                  |
| `rehearse`                     | what to watch during the dry run               |
| `pack`                         | all of the above, from one compile             |
| `lint`, `fmt`, `annotate`      | working on the script itself                   |
| `distance`, `codes`, `version` | reference                                      |

## building it

```
npm install
npm test
npm run build
```

Node 20.11 or newer. No runtime dependencies.

## a warning

portfire computes timings and distances. It does not make a display safe. Every
number it produces is a starting point for a competent operator to check, and
the rules that apply where you are firing are the ones that count.
