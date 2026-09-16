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

## Holds

Compilation reserves a resource for the whole of a cue's interval and reports
`CF4001` or `CF4002` when the plan books more claimants than the resource has
capacity. Rehearsal does not double-book. A cue is called at its planned
instant, and it starts there only when every resource it uses has a free
slot. Otherwise it holds.

- A resource with `capacity` slots has a free slot while fewer than
  `capacity` started cues hold it. A holder releases at its completion
  instant, or at its failure instant when it fails while running.
- Reservations are half-open. A release at instant `t` frees the slot for a
  cue called at `t`, and such a cue is not held.
- A held cue starts at the first instant every resource it uses has a free
  slot, taken together. It holds nothing while it waits, and its `requires`
  states are checked at the instant it actually starts.
- When several cues could take the last free slot at one instant, the cue
  with the earlier planned instant starts first; equal planned instants are
  ordered by cue id.

The planned instant of an absolute, event or manual cue is what the compiled
plan, the delays and the GO give it. An `after` dependent with an offset of
zero or more is called at its dependency's actual start plus the offset (plus
its own delay), never before the dependency started, so a hold on the
dependency moves the dependent by the same amount; that call is the
dependent's planned instant. A dependent with a negative offset keeps the
planned instant it already had: it cannot wait for an instant that is not yet
known, and it is not moved by a hold on its dependency. A dependency that
fails without starting resolves its dependents from the failure instant.

Every cue that started later than it was called is reported once as `CF7001`
with severity `warning`, subject kind `cue`, and the witness keys
`planned_ms`, `start_ms`, `held_ms` and `resources`, the last being the used
resource ids that had no free slot at the planned instant, sorted and joined
with commas. The rehearsal result carries the same facts as `holds`, ordered
by planned instant then cue id, each entry holding `cue_id`, `planned_ms`,
`start_ms`, `held_ms` and `resources` as a list. Statuses and events keep
their shape: `eligible` is emitted at the planned instant and `started` at
the actual one. A rehearsal whose only findings are holds has no errors, so
`rehearse` and `report` exit `0` for it.
