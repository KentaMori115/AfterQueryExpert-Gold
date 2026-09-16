"""Master and departmental cue sheets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cueforge.compiler.plan import CompiledShow


@dataclass(frozen=True, slots=True)
class CueSheetRow:
    cue_id: str
    department: str
    start_ms: int | None
    duration_ms: int
    trigger_kind: str
    uses: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CueSheet:
    production_id: str
    department: str | None
    rows: tuple[CueSheetRow, ...]

    def semantic_dict(self) -> dict[str, Any]:
        return {
            "department": self.department,
            "production_id": self.production_id,
            "rows": [
                {
                    "cue_id": row.cue_id,
                    "department": row.department,
                    "duration_ms": row.duration_ms,
                    "start_ms": row.start_ms,
                    "trigger_kind": row.trigger_kind,
                    "uses": list(row.uses),
                }
                for row in self.rows
            ],
        }


def render_sheet(show: CompiledShow, department: str | None = None) -> CueSheet:
    cues = show.cues
    if department is not None:
        cues = tuple(cue for cue in cues if cue.department == department)
    rows = tuple(
        CueSheetRow(
            cue_id=cue.id,
            department=cue.department,
            start_ms=cue.start_ms,
            duration_ms=cue.duration_ms,
            trigger_kind=cue.trigger_kind,
            uses=cue.uses,
        )
        for cue in sorted(
            cues,
            key=lambda item: (
                item.start_ms is None,
                item.start_ms if item.start_ms is not None else 0,
                item.id,
            ),
        )
    )
    return CueSheet(production_id=show.production_id, department=department, rows=rows)
