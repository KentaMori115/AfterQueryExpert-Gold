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

## Overflow

Values outside signed 64-bit range produce `CF2004`. Scientific notation
produces `CF2002`. Fractional millisecond tokens produce `CF2007`.
