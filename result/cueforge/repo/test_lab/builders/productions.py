"""Small helpers for hand-written test productions."""

from __future__ import annotations

from typing import Any


def absolute_cue(cue_id: str, at: int, duration: int = 0, department: str = "lighting") -> dict[str, Any]:
    return {
        "id": cue_id,
        "department": department,
        "trigger": {"at": at},
        "duration": duration,
    }


def two_cue_chain() -> dict[str, Any]:
    return {
        "version": 1,
        "production": "chain",
        "time_unit": "ms",
        "cues": [
            absolute_cue("a", 0, 100),
            {
                "id": "b",
                "department": "lighting",
                "trigger": {"after": "a", "offset": 50},
                "duration": 100,
            },
        ],
    }
