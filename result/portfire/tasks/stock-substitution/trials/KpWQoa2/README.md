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

## firing what you actually have

A show is designed against the house catalog and fired out of whatever the
magazine holds, and those two are never the same. Give any show command a
magazine book and the compiler draws the show out of it, one round at a time in
firing order: every cue takes the shell it was written for while stock lasts,
and only then do the cues left short take a stand-in of the same calibre. Every
cue carries the lot it was drawn from onto the cue sheet, which is what makes a
recall a matter of pulling one case rather than the whole magazine.

```
portfire check show.pf --catalog house.csv --rig autumn.rig --magazine book.csv
portfire sheet show.pf --catalog house.csv --rig autumn.rig --magazine book.csv
portfire check show.pf --catalog house.csv --rig autumn.rig --magazine book.csv \
  --pull vn2405,vn2413
```

`--pull` sets lots aside before the draw, for a recall or for stock promised to
somebody else. Nothing is written back to the book, so the book on disk stays
the record of what was delivered. A cue nothing can cover keeps the shell it was
written with and the show reads as not ready.

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
