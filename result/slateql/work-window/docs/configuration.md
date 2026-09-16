# Configuration

A `SessionConfig` is an immutable bundle of tuning knobs. Every value has a
conservative default, so `SessionConfig()` is always valid.

```python
from slateql import Session, SessionConfig

session = Session(config=SessionConfig(batch_size=4096, null_ordering="nulls_first"))
session.configure(strict_casts=True)          # replaces the config in place
```

From the command line, use `--set option=value` (repeatable):

```console
$ slateql --csv t=data.csv --set optimize=false --set batch_size=1 query "SELECT * FROM t"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `batch_size` | `1024` | Maximum rows an operator emits in one record batch. Must be positive. Changing it never changes results. |
| `optimize` | `True` | When false the optimizer pipeline is skipped entirely. Useful for comparing plans and for isolating a suspected rule. |
| `max_rows` | `0` | Hard ceiling on rows a statement may materialise; `0` disables it. Exceeding it raises `ExecutionError`. |
| `null_ordering` | `"nulls_last"` | Default null placement for `ORDER BY` items that do not spell out `NULLS FIRST` / `NULLS LAST`. |
| `case_sensitive_identifiers` | `False` | When false, unquoted identifiers fold to lower case. |
| `strict_casts` | `False` | When true a failed `CAST` raises instead of producing `NULL`. |
| `collect_statistics` | `True` | Whether the planner may consult table statistics. Disabling it makes plans independent of the data. |
| `explain_costs` | `False` | Whether `EXPLAIN` annotates nodes with estimated cardinalities. |

Unknown option names are rejected with a `ConfigurationError` rather than
silently ignored, both in `SessionConfig.replace` and in `--set`.

## Statistics

Statistics are never gathered implicitly. Call `session.analyze()` to scan every
registered table, or `session.analyze("orders")` for one:

```python
session.analyze()
print(session.catalog.get("orders").statistics.describe())
```

Without statistics the planner falls back to a fixed row-count estimate, which
mainly affects `join-input-ordering`. Set `collect_statistics=False` to make
plans fully data-independent.
