# CueForge

A deterministic Python compiler and rehearsal simulator for live-performance
cue sheets, resource conflicts, and virtual-time traces.

CueForge loads a YAML or JSON production, validates references, resolves a
trigger graph, reserves exclusive equipment, and rehearses the plan on an
integer virtual clock. When a plan cannot work it returns a stable finding
with the smallest useful witness.

## Install

```bash
python -m pip install --require-hashes -r requirements-dev.lock
python -m pip install -e .
```

Python 3.12 is required.

## Library

```python
from cueforge import compile_production, load_production, rehearse
from cueforge.simulation import DelayCue

production = load_production("examples/concert_two_looks.yaml")
compiled = compile_production(production.value)
result = rehearse(compiled.value, interventions=[DelayCue("snd_hit", 250)])
```

The library never prints, never reads argv, and never calls `sys.exit`.

## CLI

```bash
cueforge compile examples/concert_two_looks.yaml
cueforge compile examples/concert_two_looks.yaml --format json
cueforge rehearse examples/glass_harbor.yaml
cueforge rehearse examples/concert_two_looks.yaml --delay snd_hit=250ms
cueforge sheet examples/glass_harbor.yaml --department lighting
cueforge report examples/harbor_rehearsal.yaml --format json
```

Exit codes: `0` success, `1` production or rehearsal errors, `2` usage, `3` store I/O.

## Holds

A plan can book one device for two cues at once; `compile` reports that as
`CF4001` or `CF4002`. A rehearsal never double-books. A cue called while every
slot of a resource it uses is taken holds, and starts at the first instant a
slot is free on each of its resources. Cues holding for one slot get it in
order of planned instant, then cue id. Each late start is one `CF7001`
warning and one entry under `holds` in the rehearsal result. Dependents with
non-negative `after` offsets follow the actual start; negative offsets keep
their planned instant. See `docs/timing-contract.md` and
`docs/rehearsal-holds.md`.

```bash
cueforge rehearse examples/holds/shared_wall.yaml
```

## Paper Tech

This baseline is the Paper Tech release. It supports absolute and single
dependency triggers, cycle witnesses, exclusive reservations, resource holds
during rehearsal, basic resource state, delay and fail injection, master and
departmental sheets, and canonical JSON. Compound triggers, timing-window solvers, recovery branches,
and live operator protocols are intentionally absent.

See `docs/determinism.md`, `docs/production-format.md`, and `docs/timing-contract.md`.
