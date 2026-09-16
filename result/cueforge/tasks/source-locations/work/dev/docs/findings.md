# Findings

A finding is a structured diagnostic. Codes are public.

| Range | Meaning |
|---|---|
| `CF1xxx` | Syntax, schema, path, and reference failures |
| `CF2xxx` | Time and numeric normalization |
| `CF3xxx` | Cue graph and trigger failures |
| `CF4xxx` | Resource capacity and state |
| `CF5xxx` | Movement |
| `CF6xxx` | Assertions |
| `CF7xxx` | Simulation interventions and outcomes |
| `CF8xxx` | Run-store integrity |

Human messages may become clearer. Codes, severity, subjects, and witness
keys are versioned public behavior.

## Source

Findings raised while loading or compiling a production carry `source`, a
`SourceRef` naming the file, the 1-based line and the 1-based column of the
first character of the authored node the finding is about. Findings about
nothing authored, and every finding a rehearsal raises, carry `None`. The
rules for which node a finding points at are in `docs/source-locations.md`.

Findings are sorted by severity, then by source path, line and column, then
by code, so a finding without a source comes before those with one.
