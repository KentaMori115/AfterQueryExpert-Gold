# Changelog

## Unreleased

- Findings from loading and compiling carry a `source`: file, line and column
  of the authored node they are about, for YAML and JSON productions and
  through multi-file workspaces (`docs/source-locations.md`).
- The JSON loader tracks positions itself; numeric tokens still stay text.
- Assertions are parsed and their subjects checked while compiling (CF6002,
  CF6003), instead of first failing during a rehearsal.
- `cueforge compile --format json` prints `source` on every finding, the same
  object rehearsal JSON already carries.

## 0.1.0 — Paper Tech

- Load YAML and JSON productions, including multi-file workspaces.
- Compile absolute, relative, event, and manual triggers.
- Detect trigger cycles and emit stable witnesses.
- Reserve exclusive and capacity-limited resources on half-open intervals.
- Simulate rehearsals with delay, fail, and GO interventions.
- Evaluate `before` / `after` / `state ==` assertions.
- Emit canonical JSON, text reports, departmental sheets, and NDJSON traces.
- Store immutable run artifacts with SHA-256 manifests.
