# Command-line interface

`cueforge` is a thin adapter over the public Python API.

| Command | Purpose |
|---|---|
| `compile` | Validate and compile a production |
| `rehearse` | Run a virtual-time rehearsal |
| `sheet` | Export a master or departmental cue sheet |
| `report` | Compile, rehearse, and emit a report |
| `runs inspect` | Read a stored run digest |

`--format json` writes one canonical document to stdout. Diagnostics that are
not the result document go to stderr. `NO_COLOR` disables ANSI styling.
