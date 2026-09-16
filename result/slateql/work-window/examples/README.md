# Examples

Each script is standalone and runs from the repository root.

| Script | What it shows |
| --- | --- |
| `quickstart.py` | Registering in-memory rows, filtering, grouping, `CASE`, and `EXPLAIN`. |
| `sales_report.py` | Joining the sample CSV and JSONL files, outer joins, date functions, and statistics. |
| `custom_functions.py` | Adding a scalar and an aggregate function to a private registry. |

```console
$ python examples/quickstart.py
$ python examples/sales_report.py
$ python examples/custom_functions.py
```

`make demo` runs all three.
