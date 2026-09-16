# Timing contract

All virtual times are signed 64-bit integers in milliseconds.

## Resolution

| Trigger | Start |
|---|---|
| `at` | `at + offset` |
| `on` | `events[name] + offset` |
| `after` | `start(dependency) + offset` |
| `manual` | unresolved until `GoCue` |

Delay interventions add an integer offset to the named cue, then dependents
that use `after` are re-resolved in topological order.

## Movement

Positions are integer stage units. `maximum_speed` is units per second with at
most three fractional decimal places, stored as milli-units per second.

Distance is the nearest integer square root of `dx² + dy²`. An exact tie
rounds upward. Travel time is `ceil(distance * 1_000_000 / speed_milli)`.

### Where a move departs from

A performer stands at `initial_mark`, then at the `to` of each move they
finish. Moves of one performer are followed in start order, ties by cue id,
the order simultaneous events already use. Travel, and so the compiled
duration, is computed from where the performer stands at the move's start;
a stated `from` that disagrees is `CF5004` and does not change the travel.

A move that starts while an earlier move of the same performer is still
running (half-open, like a reservation) is `CF5004`; it departs from that
earlier move's `to`. When any move of a performer has no start at compile
time (a manual cue with no GO), no position of theirs can be known: every
move of theirs must state `from`, which is then used as authored, and a move
without one is `CF3005`.

### Positions in a rehearsal

A rehearsal follows the actual starts and ends, so delays, fails and GO can
change the order in which moves happen. Compiled durations are kept. A move
whose performer stands elsewhere when it actually starts is `CF5004` in the
rehearsal findings; it runs regardless and leaves the performer at its `to`.
A failed move leaves its performer where it was. The result carries
`performer_marks`, each performer's mark once every cue has finished, next to
`resource_states`.

An assertion may name a mark: `mira.mark == center at video_12.visible`. It
holds when the performer stands at that mark at that instant. While one of
their moves is running they stand nowhere. An unknown performer or location
is `CF6003`.

## Overflow

Values outside signed 64-bit range produce `CF2004`. Scientific notation
produces `CF2002`. Fractional millisecond tokens produce `CF2007`.
