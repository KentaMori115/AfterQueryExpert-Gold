# Changelog

## 0.3.0

The release that made the thing usable by somebody who did not write it.

### The plan

- Slips, single and double, called by the interlocking the way points are.
- A formatter, so a plan comes out the same shape whoever edited it.
- The offending line printed under an error, with a mark under it.

### Working it out

- Gradient profiles, signal sighting, and the rules that go with both.
- Reversible working: rules for track that is worked both ways.
- Sub route holds that tell an overlap from a route, so a following move can
  take the overlap over instead of being refused.

### Running it

- Failures of track circuits and signal lamps, alongside points.
- Reversals, trains taken off at the boundary, and a regulator that decides who
  goes first.
- Timetables, replays, and a train graph drawn from a run.
- Relative times and notes in the scenario language.

### Checking it

- Fifty four rules, each with a written explanation, generated into
  `docs/rules.md` so it cannot go stale.
- Waivers, `--strict`, `--since` and JSON findings, which is everything a build
  needs to say what is new.
- Rules that work the interlocking rather than reading it, which is how the
  overlap holding bug was found.

### Handing it over

- The interchange file carries the design figures, the crossings, the traps and
  the mileage, and older files are migrated on the way in.
- `signalbox pack` writes the tables, the drawing, the report, the findings and
  a fingerprint.
- Cross references, measurements, panel views and a page about any one route.

## 0.2.0

The release that turned a route finder into something a scheme could be signed
off against.

### The plan

- Level crossings, trap points and derailers.
- `standards { }`, so a scheme says what figures it was drawn to and is checked
  against those rather than against this package's defaults.
- `include`, so a plan can be split across files and validated as one.
- Mileage on an edge, and chainage worked out for the rest of the layout.
- Point machines: throw time, motor, facing point lock, detection.

### Working it out

- Call on routes, warning routes, and routes that end at a boundary or a buffer.
- Sub routes with a direction, so a following move can take an overlap over.
- Approach locking, emergency release, and sectional release behind a train.
- Aspect sequences, braking distances, signal sighting and headway.
- Train protection grids, berth tracks and describer steps.

### Running it

- An interlocking that can be worked: points that take time to move, routes that
  refuse for the reasons the control table gives, and aspects that follow.
- Trains, drivers, automatic route setting and a regulator.
- Scenarios in a text file, with failures of points, track circuits and lamps.
- A history of every run, replayable, and a train graph drawn from it.

### Checking it

- Fifty four rules, each with a written explanation of why it is there.
- Waivers, so a scheme is signed off against a list of accepted findings and a
  new finding stands out.

### Handing it over

- Control, points, aspect and locking tables, as text, CSV or markdown.
- An interchange file with a schema and a fingerprint, and a diff between two.
- Schematics, panel views and a written design report.
- `signalbox pack`, which produces the lot in one directory.

## 0.1.0

The first thing that worked.

- The scheme plan language: tokeniser, parser, validation.
- The track graph, positions on it, and walking over it.
- Track sections, routes found by walking forward from each signal, overlaps,
  flank protection, conflicts and locking.
- The control table, and a command line to print it.
