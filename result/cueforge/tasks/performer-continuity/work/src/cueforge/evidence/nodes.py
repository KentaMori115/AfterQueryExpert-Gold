"""Evidence-trace nodes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class EvidenceNode:
    trace_id: str
    kind: str
    formula: str
    subjects: tuple[str, ...]
    values: Mapping[str, str | int]
    children: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "children": list(self.children),
            "formula": self.formula,
            "kind": self.kind,
            "subjects": list(self.subjects),
            "trace_id": self.trace_id,
            "values": {key: self.values[key] for key in sorted(self.values)},
        }
