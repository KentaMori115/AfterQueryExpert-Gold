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

A show is designed against the catalog and fired from whatever the magazine
holds. Hand any show command the magazine book and it draws the show from it,
cue by cue in firing order, standing another shell of the same calibre in where
the store is short and saying so. Every cue then carries the lot it came out of,
which is what the paperwork tracks.

```
portfire check show.pf --catalog house.csv --rig autumn.rig --magazine book.csv
portfire sheet show.pf --catalog house.csv --rig autumn.rig --magazine book.csv
portfire check show.pf --catalog house.csv --rig autumn.rig --magazine book.csv \
  --pull vn2405,vn2413
```

`--pull` sets lots aside before anything is drawn, which is what a recall or a
case damaged in the van means on the day. The book itself is never written to.

A worked example lives in `examples/autumn`.

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
