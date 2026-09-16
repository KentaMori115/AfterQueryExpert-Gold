# Changelog

## Unreleased

- Rehearsals hold a cue whose resources have no free slot and start it when
  a slot frees, instead of double-booking and reporting `CF4001` afterwards.
  Late starts are reported as `CF7001` warnings and listed under `holds`;
  `after` dependents with non-negative offsets follow the actual start.
  See `docs/timing-contract.md`.

## 0.1.0 — Paper Tech

- Load YAML and JSON productions, including multi-file workspaces.
- Compile absolute, relative, event, and manual triggers.
- Detect trigger cycles and emit stable witnesses.
- Reserve exclusive and capacity-limited resources on half-open intervals.
- Simulate rehearsals with delay, fail, and GO interventions.
- Evaluate `before` / `after` / `state ==` assertions.
- Emit canonical JSON, text reports, departmental sheets, and NDJSON traces.
- Store immutable run artifacts with SHA-256 manifests.
