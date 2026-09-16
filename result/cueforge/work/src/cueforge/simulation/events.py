"""Simulation event kinds and stable tie-breaking."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

# Smaller rank fires first at the same virtual time.
KIND_RANK: Mapping[str, int] = {
    "intervention": 0,
    "eligible": 1,
    "failed": 2,
    "started": 3,
    "state_changed": 4,
    "resource_reserved": 5,
    "completed": 6,
    "resource_released": 7,
    "assertion": 8,
    "pending_manual": 9,
}


@dataclass(frozen=True, slots=True)
class SimulationEvent:
    time_ms: int
    kind: str
    cue_id: str | None
    sequence: int
    cause_sequence: int | None
    entities: tuple[str, ...]
    details: Mapping[str, str | int | bool] = field(default_factory=dict)

    def sort_key(self) -> tuple[int, int, str, int]:
        return (self.time_ms, KIND_RANK.get(self.kind, 50), self.cue_id or "", self.sequence)

    def as_dict(self) -> dict[str, object]:
        return {
            "cause_sequence": self.cause_sequence,
            "cue_id": self.cue_id,
            "details": {key: self.details[key] for key in sorted(self.details)},
            "entities": list(self.entities),
            "kind": self.kind,
            "sequence": self.sequence,
            "time_ms": self.time_ms,
        }
