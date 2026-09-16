"""Normalize authored triggers into a single-kind internal form."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from cueforge.codes import CF3003_SELF_DEPENDENCY, CF3004_INVALID_TRIGGER
from cueforge.findings import Finding, Severity
from cueforge.production.models import CueDef, TriggerDef
from cueforge.timing.parse import parse_int64, parse_offset_ms

TriggerKind = Literal["absolute", "after", "event", "manual"]


@dataclass(frozen=True, slots=True)
class NormalizedTrigger:
    kind: TriggerKind
    cue_id: str
    offset_ms: int
    at_ms: int | None = None
    depends_on: str | None = None
    event: str | None = None


def normalize_trigger(cue: CueDef) -> tuple[NormalizedTrigger | None, list[Finding]]:
    findings: list[Finding] = []
    trigger: TriggerDef = cue.trigger
    offset, offset_finding = parse_offset_ms(trigger.offset, field=f"{cue.id}.offset")
    if offset_finding is not None:
        findings.append(offset_finding)
        offset = 0
    assert offset is not None

    if trigger.after is not None:
        if trigger.after == cue.id:
            findings.append(
                Finding(
                    code=CF3003_SELF_DEPENDENCY,
                    severity=Severity.ERROR,
                    message=f"cue {cue.id!r} depends on itself",
                    subject_kind="cue",
                    subject_id=cue.id,
                    witness={"after": trigger.after},
                )
            )
        return (
            NormalizedTrigger(
                kind="after",
                cue_id=cue.id,
                offset_ms=offset,
                depends_on=trigger.after,
            ),
            findings,
        )
    if trigger.on is not None:
        return (
            NormalizedTrigger(
                kind="event",
                cue_id=cue.id,
                offset_ms=offset,
                event=trigger.on,
            ),
            findings,
        )
    if trigger.at is not None:
        at_ms, at_finding = parse_int64(trigger.at, field=f"{cue.id}.at")
        if at_finding is not None:
            findings.append(at_finding)
            return None, findings
        return (
            NormalizedTrigger(kind="absolute", cue_id=cue.id, offset_ms=offset, at_ms=at_ms),
            findings,
        )
    if trigger.manual is True or trigger.manual == "true":
        return NormalizedTrigger(kind="manual", cue_id=cue.id, offset_ms=offset), findings

    findings.append(
        Finding(
            code=CF3004_INVALID_TRIGGER,
            severity=Severity.ERROR,
            message=f"cue {cue.id!r} has an invalid trigger",
            subject_kind="cue",
            subject_id=cue.id,
        )
    )
    return None, findings
