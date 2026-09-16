# Determinism contract

CueForge treats equal normalized input as a public behavioral guarantee.

## Rules

- Equal normalized input produces byte-identical canonical JSON.
- Simultaneous events use `(time_ms, kind_rank, cue_id, sequence)`.
- Kind ranks are: intervention, eligible, failed, started, state_changed,
  resource_reserved, completed, resource_released, assertion, pending_manual.
- Dictionary insertion order, filesystem order, and process identifiers never
  affect output.
- Virtual time is a signed integer millisecond value.
- Findings sort by severity, source path, line, column, code, subject kind,
  and subject identifier.
- Canonical JSON is UTF-8, no BOM, `sort_keys=True`, separators `(",", ":")`,
  and exactly one trailing newline.
- Text reports use `\n` on every platform.
- Optional randomness is absent from Paper Tech.

## What is not semantic

Comments, YAML key order, JSON key order, and the absolute path of the
production file do not participate in the compiled digest.
