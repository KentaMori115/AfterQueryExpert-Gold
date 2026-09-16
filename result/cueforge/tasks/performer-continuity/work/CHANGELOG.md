# Changelog

## Unreleased

- Follow performers from mark to mark: `from` on a move is optional and
  travel is computed from where the performer stands, in start order; a
  stated `from` that disagrees, or a move starting while an earlier move of
  the same performer still runs, is `CF5004`; an `initial_mark` naming no
  location is `CF5002`; a position that cannot be known before a GO makes
  `from` required (`CF3005`).
- Rehearsals follow actual starts and ends, report `CF5004` when a performer
  stands elsewhere at a move's actual start, and carry `performer_marks`.
- Assertions may name a mark: `mira.mark == center at video_12.visible`.

## 0.1.0 — Paper Tech

- Load YAML and JSON productions, including multi-file workspaces.
- Compile absolute, relative, event, and manual triggers.
- Detect trigger cycles and emit stable witnesses.
- Reserve exclusive and capacity-limited resources on half-open intervals.
- Simulate rehearsals with delay, fail, and GO interventions.
- Evaluate `before` / `after` / `state ==` assertions.
- Emit canonical JSON, text reports, departmental sheets, and NDJSON traces.
- Store immutable run artifacts with SHA-256 manifests.
