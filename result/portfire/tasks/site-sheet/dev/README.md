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

Every show command takes the same flags for the catalog, the rig, the frame
rate, the wind and the site, so `check` and `table` run on one show answer
the same way.

## the site sheet

`--audience 200` describes a site as one number: a straight line two hundred
metres south of the origin. That is enough for a first pass and nothing like
enough for a permit, so a surveyed site goes in a sheet, written the way the
rig sheet is, and handed to any show command as `--site`.

```
site water meadow
audience -200 -150 200 -150
hard river -300 120 300 140
soft hedge -100 60 100 60
house mill.cottage at 400 300 limit 120
limit 115
```

Coordinates are metres east and north of the same origin the rig uses. The
`audience` line is where the separation distance is measured to and a sheet
cannot do without it. A `hard` boundary is one nothing may land past; a
`soft` one is only drawn. A `house` is a noise sensitive property with the
peak level its licence allows, and `limit` covers the houses that did not
name one. `--site` and `--audience` together is a mistake rather than a
merge, and the tool says so.

With a sheet, fallout is judged where the casing lands rather than where the
mortar stands. The casing comes down from the break at `CASING_DESCENT` and
is carried downwind the whole way, so the fallout disc sits at the drifted
point with the effect's own radius. A hard boundary is crossed when that disc
reaches it, or when the flight from the mortar to the landing went over it,
which the disc alone would not show. `--wind-from` is the bearing the wind
comes from, the way a forecast gives it: wind from 180 carries fallout north.

Noise is judged at every house on the sheet against that house's limit, with
reports inside `TOGETHER_MS` of each other adding on an energy basis at that
house's distances. Over the limit is an error, within three decibels a
warning, and any single effect over the limit is named on its own.

`plan` draws each house as `H` and lists it in the key, and with `--fallout`
draws each position's widest fallout disc where it lands, downwind when a
wind is given. `permit` and `pack` take the site's name from the sheet and
quote the nearest hard boundary and the peak at each house, and
`crowd --site` reads the frontage off the audience line instead of
`--frontage`.

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
