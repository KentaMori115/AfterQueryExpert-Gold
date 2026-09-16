"""Semantic validation that runs during compilation."""

from __future__ import annotations

from cueforge.codes import (
    CF1004_SCHEMA_VERSION,
    CF2005_BAD_UNIT,
    CF3006_EMPTY_CUE_LIST,
    CF4005_UNKNOWN_STATE,
)
from cueforge.findings import Finding, Severity
from cueforge.production.models import Production, SUPPORTED_SCHEMA_VERSIONS, SUPPORTED_TIME_UNITS
from cueforge.timing.parse import parse_duration_ms, parse_int64


def validate_production_shell(production: Production) -> list[Finding]:
    findings: list[Finding] = []
    if production.version not in SUPPORTED_SCHEMA_VERSIONS:
        findings.append(
            Finding(
                code=CF1004_SCHEMA_VERSION,
                severity=Severity.ERROR,
                message=f"unsupported schema version {production.version}",
                subject_kind="production",
                subject_id=production.production,
                witness={"version": production.version},
            )
        )
    if production.time_unit not in SUPPORTED_TIME_UNITS:
        findings.append(
            Finding(
                code=CF2005_BAD_UNIT,
                severity=Severity.ERROR,
                message=f"unsupported time_unit {production.time_unit!r}",
                subject_kind="production",
                subject_id=production.production,
            )
        )
    if not production.cues:
        findings.append(
            Finding(
                code=CF3006_EMPTY_CUE_LIST,
                severity=Severity.ERROR,
                message="production has no cues",
                subject_kind="production",
                subject_id=production.production,
            )
        )
    for name, resource in production.resources.items():
        if resource.states and resource.initial_state and resource.initial_state not in resource.states:
            findings.append(
                Finding(
                    code=CF4005_UNKNOWN_STATE,
                    severity=Severity.ERROR,
                    message=f"resource {name!r} initial_state {resource.initial_state!r} is not declared",
                    subject_kind="resource",
                    subject_id=name,
                    witness={"state": resource.initial_state},
                )
            )
    for event_id, raw in production.events.items():
        _, finding = parse_int64(raw, field=f"events.{event_id}")
        if finding is not None:
            findings.append(finding)
    for cue in production.cues:
        _, finding = parse_duration_ms(cue.duration, field=f"{cue.id}.duration")
        if finding is not None:
            findings.append(finding)
    return findings
