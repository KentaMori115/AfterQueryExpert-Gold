"""Resolve cue start times from a trigger graph."""

from __future__ import annotations

from dataclasses import dataclass

from cueforge.codes import CF2004_OVERFLOW, CF3001_MISSING_CUE
from cueforge.compiler.triggers import NormalizedTrigger
from cueforge.findings import Finding, Severity
from cueforge.timing.instants import INT64_MAX, INT64_MIN


@dataclass(frozen=True, slots=True)
class ResolvedSchedule:
    starts: dict[str, int | None]
    order: tuple[str, ...]


def resolve_starts(
    triggers: dict[str, NormalizedTrigger],
    order: tuple[str, ...],
    events: dict[str, int],
    delays: dict[str, int] | None = None,
) -> tuple[ResolvedSchedule, list[Finding]]:
    """Resolve GO times. ``after`` is relative to the dependency's start."""
    findings: list[Finding] = []
    starts: dict[str, int | None] = {}
    extra = delays or {}

    for cue_id in order:
        trigger = triggers[cue_id]
        start: int | None
        if trigger.kind == "absolute":
            assert trigger.at_ms is not None
            start = trigger.at_ms + trigger.offset_ms
        elif trigger.kind == "event":
            assert trigger.event is not None
            event_at = events[trigger.event]
            start = event_at + trigger.offset_ms
        elif trigger.kind == "after":
            dep = trigger.depends_on
            if dep is None or dep not in starts:
                findings.append(
                    Finding(
                        code=CF3001_MISSING_CUE,
                        severity=Severity.ERROR,
                        message=f"cannot resolve start for {cue_id!r}; missing dependency",
                        subject_kind="cue",
                        subject_id=cue_id,
                    )
                )
                start = None
            else:
                dep_start = starts[dep]
                start = None if dep_start is None else dep_start + trigger.offset_ms
        else:
            start = None

        if start is not None:
            start += extra.get(cue_id, 0)
            if start < INT64_MIN or start > INT64_MAX:
                findings.append(
                    Finding(
                        code=CF2004_OVERFLOW,
                        severity=Severity.ERROR,
                        message=f"resolved start for {cue_id!r} overflows int64",
                        subject_kind="cue",
                        subject_id=cue_id,
                    )
                )
                start = None
        starts[cue_id] = start

    return ResolvedSchedule(starts=starts, order=order), findings
