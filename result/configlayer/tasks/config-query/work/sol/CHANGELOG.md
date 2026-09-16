All notable changes to configlayer are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.8.0] — Unreleased

### Added
- `configlayer.query` — glob queries over nested configuration, using the
  same dotted-glob pattern language as layer policies: `select` (matched
  nodes in document order, outermost match wins), `first`, `paths`,
  `values`, and the shape-preserving `pick`/`prune` complements.  `Match`
  records carry the full dotted path and the value.
- `select`, `pick` and `prune` re-exported from the top-level package.

## [0.7.0] — 2026-07-20

### Added
