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

## firing from stock

A show is designed against the catalog and fired against the magazine, and
the two are never quite the same on the day. Point any show command at the
magazine book and the compile draws every shot from stock:

```
portfire check show.pf --catalog house.csv --rig autumn.rig --magazine book.csv
portfire sheet show.pf --catalog house.csv --rig autumn.rig --magazine book.csv --pull vn2405
```

Shots draw their own effect in firing order, so when a line runs out it is
the last cues that go without, and only after every cue has drawn its own
are the ones left without covered by a stand-in, chosen the way `substitutesFor`
ranks them and drawn from whatever is left. Lots drain oldest first, undated
lots last, and the lot each cue fires from goes onto the cue sheet, a
column that appears the moment a book is given and stays blank on any cue
nothing covered. `--pull`
takes a lot out of the book before anything is drawn, which is what a recall
means for the show. An exact stand-in is a note, a band match is a warning,
and a cue nothing can cover is an error.

The book is the magazine csv `inventory` already reads: `lot`, `effect`,
`quantity`, then `received` as an ISO date and a free `note`. Rows without a
date load fine and drain last. `inventory --magazine` keeps printing the order
list, counted on what the script asks for rather than on what stood in, and
adds the stand-in table under it when something is short. `check --stats`,
`pack` and `permit` each carry a line or a section on what was drawn, and
`explain` shows the lot and the asked-for effect on a covered cue. Once a
show has fired, `inventory --magazine book.csv --after book.csv` writes the
book back with every lot less what the show drew from it and the pulled lots
gone, which is the record the next show is checked against.

Against a book two six inch palms short, `check --magazine` says so as a note
and the show stays ready, because a six inch willow breaks at the same height
on the same lift and only the sheet changes:

```
note PF1601: shell.150.palm short, shell.150.willow stands in for 2 shots
ready, 32 cues, 0 errors, 0 warnings
```

Pull the willow lot as well and the two cues have nothing behind them, which
is an error rather than a warning, because a cue with no shell in the mortar
is a hole in the show and not a matter of judgement:

```
error PF1600: nothing in stock can stand in for 2 shots of shell.150.palm
help: redesign the cue, or buy in
not ready, 32 cues, 1 error, 0 warnings
```

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
