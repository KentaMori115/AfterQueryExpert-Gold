## [0.8.0] — Unreleased

### Added
- `configlayer.export` — render resolved configuration back out as text:
  `export_config(data, format=...)` with canonical JSON (sorted keys, stable
  indentation), dotenv (`db.host` → `DB__HOST`, quoting only where needed)
  and INI (top-level sections, dotted option names), plus
  `redact_secrets=` masking via
  `configlayer.secrets.redact` and an `ExportError` naming the dotted path
  of anything unrepresentable.
- `export_path(data, path)` — render and write in one step, picking the
  format from the file extension (`.json`, `.env`, `.ini`).
- `export_config` and `ExportError` re-exported from the top-level package.

