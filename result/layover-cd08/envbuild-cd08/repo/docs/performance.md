# Where the time goes

Numbers below come from `tools/bench.py` on a grid city: a stop at every
crossing of a square grid, a line along every row and every column, a trip every
ten minutes from six in the morning until ten at night. Two sizes, one machine,
one afternoon. They are here to say which operations are cheap and which are
not, and to be compared against each other rather than against another engine.

```
python3 tools/bench.py --side 12
python3 tools/bench.py --side 20
```

| | 12 by 12, 2,310 trips | 20 by 20, 3,848 trips |
| --- | --- | --- |
| build the network | 100 ms | 168 ms |
| first lookup of a day | 0.4 ms | 0.8 ms |
| the same lookup again | under 0.1 ms | under 0.1 ms |
| a departure board | 1.6 ms | 1.6 ms |
| plan corner to corner | 47 ms | 227 ms |
| reach every stop | 72 ms | 230 ms |

## What that says

**Building is one pass and stays that way.** The builder checks every reference
once, and the network indexes itself afterwards: patterns by stop, trips by
pattern, children by station, transfers by origin. Nothing is worked out again
later, which is why a lookup is a dictionary hit.

**A day is worked out once.** `Timetable.trips_on` filters a pattern's trips by
the services running on a date and keeps the answer. The first question about a
date pays for it and the rest are free, which matters because a search asks the
same question thousands of times.

**A board does not depend on how big the network is.** It walks the patterns
calling at one stop and no others, so a board on a grid of four hundred stops
costs what a board on a grid of a hundred and forty costs.

**A search grows with the network, not with the timetable.** Each round scans
every pattern reachable from a marked stop, and the boarding lookup inside it is
a binary search over the departures at that position. Doubling the number of
trips barely moves it; doubling the number of stops moves it a lot. Corner to
corner on the larger grid crosses more lines and needs more rounds.

## Where the memory goes

Everything is held in memory as Python objects: a `Trip` per trip with two
tuples of integers, a `Pattern` per pattern with a tuple of stop identifiers,
and the indexes above. A feed with a hundred thousand trips is comfortable; a
national feed with several million is not, and that is what the packed on-disk
index in the README's gap list is for.

The one cache that grows without being asked is the boarding index inside
`JourneySearch`, which is keyed by date, pattern and position. A session that
plans over one date touches a bounded part of it. A long lived session planning
over many dates should be given a fresh search rather than kept forever.

## Rules of thumb

- Ask for a date once and hold the `Timetable`; do not build one per question.
- Hold one `JourneySearch` for a batch of queries over the same date, and let it
  go afterwards.
- `reachable` costs about what one search costs, so use it instead of planning
  to every stop in turn.
- `plan_profile` runs the search again for every departure it finds. Ask for a
  window you actually want, and pass a limit.
