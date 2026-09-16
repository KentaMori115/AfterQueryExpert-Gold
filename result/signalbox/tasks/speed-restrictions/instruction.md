Slacks get put on schemes and this one cannot write one down: a plan drawn for
60 is checked at 60 where renewals hold 20.

Teach plans a restriction:

```
restriction TSR1 on D2 at 600 for 400 speed 20 reason "renewals"
```

It starts 600 metres along D2, runs 400 onward over as much track as that
takes, following road points lie normal for, and stops where track ends. Words
after speed are kept as `attributes`, `signalbox fmt` writes it back, `include`
merges them too. Refuse one on track nothing declares, one starting past its
edge, one with no length, one at no speed, one already named, the way a signal
off the end of its edge is refused, not at reading.

A scheme answers `scheme.restriction(name)` with its `speed`,
`scheme.restrictions_on(edge)` for what reaches a piece of track, and
`scheme.permissible_speed(edge, offset)`: line speed held down by every
restriction over that place, restricted speed alone where track has none,
slowest where two overlap.

Trains must be brought down.
`signalling.restriction.approach_for(scheme, restriction)` works the braking
backwards from the first restricted metre, a stretch of track at a time: at the
far end of each stretch the train was going as fast as that stretch's own
gradient leaves it, braking begins inside the stretch where that reaches line
speed, and a reaction allowance at line speed goes in front. It hands back
`distance` and a `board`, nothing where track runs out first. Rule
`restriction-room` reports that one, error grade.

Spacing wants the fastest permitted over a route, headway the slowest, so a
scheme answers `fastest_on(edge)` and `slowest_on(edge)`: a slack over part of a
piece leaves the rest at line speed. Drivers keep to it.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
