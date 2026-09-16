"""Rehearsal interventions: delay, fail, and manual GO."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class DelayCue:
    cue_id: str
    delay_ms: int


@dataclass(frozen=True, slots=True)
class FailCue:
    cue_id: str
    at_ms: int | None = None


@dataclass(frozen=True, slots=True)
class GoCue:
    cue_id: str
    at_ms: int


Intervention = DelayCue | FailCue | GoCue
