"""Simple resource state: required start state plus one authored transition."""

from __future__ import annotations

from dataclasses import dataclass

from cueforge.codes import CF4003_ILLEGAL_STATE, CF4005_UNKNOWN_STATE, CF4006_BAD_TRANSITION
from cueforge.findings import Finding, Severity


@dataclass(frozen=True, slots=True)
class ResourceState:
    resource_id: str
    current: str
    allowed: tuple[str, ...]


def apply_transition(
    state: ResourceState,
    *,
    cue_id: str,
    required: str | None,
    next_state: str | None,
) -> tuple[ResourceState, list[Finding]]:
    findings: list[Finding] = []
    if required is not None:
        if required not in state.allowed:
            findings.append(
                Finding(
                    code=CF4005_UNKNOWN_STATE,
                    severity=Severity.ERROR,
                    message=f"resource {state.resource_id!r} has no state {required!r}",
                    subject_kind="resource",
                    subject_id=state.resource_id,
                    witness={"cue": cue_id, "state": required},
                )
            )
        elif state.current != required:
            findings.append(
                Finding(
                    code=CF4003_ILLEGAL_STATE,
                    severity=Severity.ERROR,
                    message=(
                        f"cue {cue_id!r} requires {state.resource_id}.{required} "
                        f"but current state is {state.current}"
                    ),
                    subject_kind="resource",
                    subject_id=state.resource_id,
                    witness={
                        "cue": cue_id,
                        "required": required,
                        "actual": state.current,
                    },
                )
            )
    if next_state is None or findings:
        return state, findings
    if next_state not in state.allowed:
        findings.append(
            Finding(
                code=CF4006_BAD_TRANSITION,
                severity=Severity.ERROR,
                message=f"cue {cue_id!r} cannot transition {state.resource_id!r} to {next_state!r}",
                subject_kind="resource",
                subject_id=state.resource_id,
                witness={"cue": cue_id, "next": next_state},
            )
        )
        return state, findings
    return ResourceState(state.resource_id, next_state, state.allowed), findings
