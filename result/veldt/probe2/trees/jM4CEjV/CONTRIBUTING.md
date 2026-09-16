# Working on veldt

## Setup

The engine itself has no third-party runtime dependencies. Running the tests
needs `pytest`.

```
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

## Running things

```
python -m pytest                      # the whole suite
python -m pytest tests/test_sql_execution.py -q
python examples/quickstart.py         # a tour of the engine
python -m veldt.cli.main query --csv t=examples/data/trips.csv "SELECT * FROM t LIMIT 3"
```

## House style

* **Docstrings say why, not what.** A docstring that restates the signature is
  noise. One that explains a decision — why nulls sort first, why a rule
  refuses to fire — earns its place.
* **`Raises:` is part of the contract.** If a function raises deliberately,
  document it.
* **Prefer returning a new object over mutating.** Schemas, plans and
  expressions are immutable; keeping them that way is what makes the optimizer
  safe to reason about.
* **No bare `except`.** Catch what you can handle and re-raise the rest with
  context.

## Adding to the engine

**A scalar function** goes in `veldt/expr/functions.py`, in the section that
matches its category, and needs a `doc` string. Decide deliberately whether it
propagates nulls; the default is yes. If it is pure, add it to
`_PURE_FUNCTIONS` in `veldt/expr/simplify.py` so it can be folded.

**An aggregate** needs an `Accumulator` in `veldt/expr/aggregates.py`
implementing `update`, `merge` and `finalize`. `merge` is not optional even
though nothing calls it yet — an accumulator that cannot combine partial state
is a dead end for parallel execution.

**An optimizer rule** goes in `veldt/plan/rules.py` and must be semantics
preserving, idempotent, and independent of rule ordering. Add it to
`default_rules()` and give it tests that assert on the rewritten plan, not on
the rows.

**A data source** subclasses `DataSource` in `veldt/storage/base.py`. Respect
the projection you are given. Only override `supports_filter_pushdown` if you
genuinely apply the predicates you accept — the scan operator will not check.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request to `main`, and can be started by hand from the Actions tab. Three
jobs:

| Job | What it proves |
| --- | --- |
| `test` | The suite passes on Python 3.10, 3.11, 3.12 and 3.13 |
| `quickstart` | The example script and the CLI still work against the sample data |
| `byte-compile` | Every module under `src`, `tests` and `examples` compiles |

The matrix does not fail fast, so one version breaking still tells you about
the others. Everything CI runs has a local equivalent in the `Makefile` — if
`make test` and `make example` pass, CI should too.

## Testing

Tests assert on behaviour through public APIs. A test that reaches into a
private attribute is testing today's implementation, not the contract.

Every bug fix gets a test that fails without it. Several of the tests in this
suite exist because a fixture happened to expose a real bug; those are the
valuable ones.
