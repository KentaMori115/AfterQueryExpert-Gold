"""NDJSON execution traces."""

from __future__ import annotations

from cueforge.reports.canonical_json import canonical_dumps
from cueforge.simulation.events import SimulationEvent


def events_to_ndjson(events: tuple[SimulationEvent, ...] | list[SimulationEvent]) -> str:
    lines = [canonical_dumps(event.as_dict()).rstrip("\n") for event in events]
    return "\n".join(lines) + ("\n" if lines else "")
