# Production format

Paper Tech productions are YAML or JSON documents with `version: 1`.

## Top-level fields

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Schema version. Only `1` is accepted. |
| `production` | yes | Stable production identifier. |
| `time_unit` | yes | Must be `ms`. |
| `events` | no | Named show events mapped to integer millisecond times. |
| `resources` | no | Equipment and other capacity-limited entities. |
| `performers` | no | Neutral performer identities and initial marks. |
| `locations` | no | Integer `(x, y)` stage points. |
| `cues` | yes | Cue declarations. An empty list is an error. |
| `assertions` | no | Authored consistency checks. |

## Triggers

A cue trigger sets exactly one of:

- `at` — absolute virtual time
- `after` — another cue id; relative to that cue's start
- `on` — a named event
- `manual: true` — ineligible until a GO intervention

`offset` is an integer millisecond value and may be negative.

## Resources

```yaml
revolve:
  kind: stage_automation
  capacity: 1
  states: [locked, moving, home, scene_two]
  initial_state: home
```

Reservations use the half-open interval `[start, start + duration)`.
Intervals that only touch at a boundary do not conflict.

## Performers and moves

```yaml
performers:
  mira:
    initial_mark: stage_left
```

`initial_mark` must name a location (`CF5002` otherwise). A move action names
the performer, the destination and a speed; `from` is optional:

```yaml
action: {move: mira, to: center, maximum_speed: 1.4}
```

A performer stands at `initial_mark`, then at the `to` of each move they
finish. Travel is computed from where the performer stands when the move
starts, so the compiled cue's `action` always carries the resolved `from`.
A stated `from` that disagrees is `CF5004`. See `docs/timing-contract.md`
for how positions are followed.

## Multi-file workspaces

A directory may contain `cueforge.yaml` with a `sources` list of root-relative
paths. Absolute paths and `..` segments are rejected.
