# Contributing to tanager

Thanks for your interest in improving tanager. This is a small, dependency-free
codebase and the bar for contributions is simply: keep it correct, deterministic,
and readable.

## Development workflow

```console
$ cargo build            # build the library and the `tanager` binary
$ cargo test             # run unit + integration tests
$ cargo fmt              # format (CI enforces `cargo fmt --check`)
$ cargo clippy --all-targets -- -D warnings
```

Please run all four before opening a pull request. CI runs the same checks.

## Guidelines

- **Tests are behavioral.** Add tests that run queries through the public
  `Database` API and assert on results, not on internal structure. Every new
  feature needs coverage; every bug fix needs a regression test.
- **Determinism is non-negotiable.** No wall-clock, randomness, or reliance on
  hash-map iteration order in query results. If you introduce a collection whose
  order is observable, make it deterministic (see `exec::executor`).
- **Keep NULL semantics correct.** New expression code must go through the
  three-valued helpers rather than treating `NULL` as `false`.
- **Errors carry a kind.** Return the appropriate `ErrorKind` (`Parse`, `Binder`,
  `Type`, `Execution`, ...) so callers and tests can classify failures without
  matching on message text.
- **Match the surrounding style.** Small, focused functions; doc comments on
  public items; comments that explain *why*, not *what*.

## Where things live

See [docs/DESIGN.md](docs/DESIGN.md) for the pipeline and the steps to add a
scalar function, an aggregate, an operator, or an optimizer rule.

## Commit messages

Write imperative, present-tense summaries (“Add …”, “Fix …”) with a short body
explaining the motivation. Keep each commit focused on one change.
