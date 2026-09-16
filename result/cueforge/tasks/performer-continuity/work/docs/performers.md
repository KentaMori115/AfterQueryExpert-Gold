# Performers and marks

A production may name performers and the marks they stand on. Paper Tech
uses them for one thing: the travel time of a move, which decides the move's
duration when none is authored and rejects one that is too short (`CF5001`).

## Where a performer stands

- At `initial_mark` until their first move finishes. `initial_mark` must
  name an entry of `locations`, or the production fails with `CF5002`.
- At the `to` of each move they finish. When several moves of one performer
  overlap, the one that finished last decides.
- Nowhere while one of their moves is running. Running is half-open, like a
  reservation: a move that ends at `t` has finished at `t`.
- A failed move leaves the performer where it was, whether it failed before
  it started or while it was running.

## How a move departs

`from` on a move is optional. Travel is always computed from where the
performer stands when the move starts, and the compiled cue's `action`
carries that mark as `from`, so a production that omits `from` and one that
states the right mark compile to the same plan and the same digest.

The compiler follows each performer's moves in start order, ties by cue id,
which is the order the rehearsal gives simultaneous events. Along the way it
reports:

| Situation | Finding |
|---|---|
| `from` is stated and names another mark than the performer stands on | `CF5004` (error); travel still comes from the real position |
| the move starts while an earlier move of the same performer still runs | `CF5004` (error); the move departs from that earlier move's `to` |
| a move of the performer has no start yet (a manual cue before its GO) | every move of theirs must state `from`; one without it is `CF3005` (error) |

When the position is unknown the stated `from` is used as authored and no
disagreement can be reported at compile time; the rehearsal checks it once
the GO is known.

## In a rehearsal

Delays, fails and GO interventions change when moves actually start and end,
and can change their order. A rehearsal keeps the compiled durations and
follows the actual instants. A move whose performer does not stand on its
compiled `from` when it actually starts is reported as `CF5004` (error) in
the rehearsal findings; the move runs regardless and leaves the performer at
its `to`.

The rehearsal result carries `performer_marks`, each performer's mark once
every cue has finished, next to `resource_states`, in the library and in the
JSON report.

## Asserting a mark

```yaml
assertions:
  - expression: "mira.mark == center at video_12.visible"
```

holds when `mira` stands on `center` at the instant `video_12` becomes
visible. While one of her moves is running she stands nowhere, so the
assertion fails then. A performer or location the production does not
declare is `CF6003`.

## Example

`examples/blocking_rehearsal.yaml` moves `mira` twice on independent
triggers. The second move omits `from` and departs from the first move's
`to`. Delaying the first move past the second (`cueforge rehearse
examples/blocking_rehearsal.yaml --delay mira_cross=8000ms`) reports both
moves with `CF5004`: the second finds her still on `stage_left`, the first
then starts while the second is running.
