"""Deterministic virtual-time rehearsal scheduler."""

from __future__ import annotations

from dataclasses import dataclass, field
from heapq import heappop, heappush
from typing import Any

from cueforge.assertions.evaluate import evaluate_assertions
from cueforge.codes import (
    CF4003_ILLEGAL_STATE,
    CF7002_CUE_FAILED,
    CF7003_UNKNOWN_INTERVENTION,
    CF7004_PENDING_MANUAL,
)
from cueforge.compiler.plan import CompiledCue, CompiledShow
from cueforge.compiler.triggers import NormalizedTrigger
from cueforge.findings import Finding, Severity, sort_findings
from cueforge.resources.capacity import detect_capacity_conflicts
from cueforge.resources.reservations import Interval, Reservation
from cueforge.resources.state import ResourceState, apply_transition
from cueforge.simulation.clock import VirtualClock
from cueforge.simulation.events import KIND_RANK, SimulationEvent
from cueforge.simulation.interventions import DelayCue, FailCue, GoCue, Intervention
from cueforge.timing.schedule import resolve_starts


@dataclass(frozen=True, slots=True)
class CueStatus:
    cue_id: str
    status: str
    start_ms: int | None
    end_ms: int | None
    fail_ms: int | None


@dataclass(frozen=True, slots=True)
class RehearsalResult:
    compiled: CompiledShow
    events: tuple[SimulationEvent, ...]
    statuses: tuple[CueStatus, ...]
    reservations: tuple[Reservation, ...]
    findings: tuple[Finding, ...]
    resource_states: dict[str, str]
    interventions: tuple[str, ...]
    digest: str

    def semantic_dict(self) -> dict[str, Any]:
        return {
            "compiled_digest": self.compiled.digest,
            "digest": self.digest,
            "events": [event.as_dict() for event in self.events],
            "findings": [_finding_dict(item) for item in self.findings],
            "interventions": list(self.interventions),
            "production_id": self.compiled.production_id,
            "reservations": [
                {
                    "cue_id": item.cue_id,
                    "end_ms": item.interval.end_ms,
                    "resource_id": item.resource_id,
                    "start_ms": item.interval.start_ms,
                }
                for item in self.reservations
            ],
            "resource_states": {
                key: self.resource_states[key] for key in sorted(self.resource_states)
            },
            "statuses": [
                {
                    "cue_id": item.cue_id,
                    "end_ms": item.end_ms,
                    "fail_ms": item.fail_ms,
                    "start_ms": item.start_ms,
                    "status": item.status,
                }
                for item in self.statuses
            ],
        }


def _finding_dict(finding: Finding) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": finding.code,
        "message": finding.message,
        "severity": str(finding.severity),
        "subject_id": finding.subject_id,
        "subject_kind": finding.subject_kind,
        "witness": {key: finding.witness[key] for key in sorted(finding.witness)},
    }
    if finding.source is not None:
        payload["source"] = {
            "column": finding.source.column,
            "line": finding.source.line,
            "path": finding.source.path,
        }
    return payload


@dataclass
class _QueueItem:
    time_ms: int
    kind: str
    cue_id: str
    sequence: int
    payload: dict[str, Any] = field(default_factory=dict)

    def key(self) -> tuple[int, int, str, int]:
        return (self.time_ms, KIND_RANK.get(self.kind, 50), self.cue_id, self.sequence)


def _triggers_from_show(show: CompiledShow) -> dict[str, NormalizedTrigger]:
    triggers: dict[str, NormalizedTrigger] = {}
    for cue in show.cues:
        depends = cue.depends_on[0] if cue.depends_on else None
        at_ms = None
        if cue.trigger_kind == "absolute" and cue.start_ms is not None:
            at_ms = cue.start_ms - cue.offset_ms
        triggers[cue.id] = NormalizedTrigger(
            kind=cue.trigger_kind,  # type: ignore[arg-type]
            cue_id=cue.id,
            offset_ms=cue.offset_ms,
            at_ms=at_ms,
            depends_on=depends,
            event=cue.event,
        )
    return triggers


def run_rehearsal(
    show: CompiledShow,
    interventions: tuple[Intervention, ...] | list[Intervention] = (),
) -> RehearsalResult:
    findings: list[Finding] = []
    delays: dict[str, int] = {}
    fails: dict[str, int | None] = {}
    gos: dict[str, int] = {}
    intervention_labels: list[str] = []

    cue_ids = {cue.id for cue in show.cues}
    for item in interventions:
        if isinstance(item, DelayCue):
            if item.cue_id not in cue_ids:
                findings.append(_unknown(item.cue_id))
                continue
            delays[item.cue_id] = delays.get(item.cue_id, 0) + item.delay_ms
            intervention_labels.append(f"delay:{item.cue_id}:{item.delay_ms}")
        elif isinstance(item, FailCue):
            if item.cue_id not in cue_ids:
                findings.append(_unknown(item.cue_id))
                continue
            fails[item.cue_id] = item.at_ms
            intervention_labels.append(
                f"fail:{item.cue_id}:{item.at_ms if item.at_ms is not None else 'start'}"
            )
        elif isinstance(item, GoCue):
            if item.cue_id not in cue_ids:
                findings.append(_unknown(item.cue_id))
                continue
            gos[item.cue_id] = item.at_ms
            intervention_labels.append(f"go:{item.cue_id}:{item.at_ms}")

    triggers = _triggers_from_show(show)

    schedule, schedule_findings = resolve_starts(
        triggers, show.order, dict(show.events), delays
    )
    findings.extend(schedule_findings)

    # Apply manual GO times after relative resolution.
    starts = dict(schedule.starts)
    for cue in show.cues:
        if cue.trigger_kind == "manual":
            starts[cue.id] = gos.get(cue.id)
            # dependents of manual cues need a second pass
    if gos:
        for cue_id in show.order:
            trigger = triggers[cue_id]
            if trigger.kind == "after" and trigger.depends_on is not None:
                dep = starts.get(trigger.depends_on)
                starts[cue_id] = None if dep is None else dep + trigger.offset_ms + delays.get(
                    cue_id, 0
                )

    clock = VirtualClock(0)
    seq = 0
    heap: list[tuple[tuple[int, int, str, int], _QueueItem]] = []

    def push(time_ms: int, kind: str, cue_id: str, payload: dict[str, Any] | None = None) -> int:
        nonlocal seq
        seq += 1
        item = _QueueItem(time_ms, kind, cue_id, seq, payload or {})
        heappush(heap, (item.key(), item))
        return seq

    events: list[SimulationEvent] = []
    statuses: dict[str, CueStatus] = {}
    live_reservations: list[Reservation] = []
    states: dict[str, ResourceState] = {}
    initials: dict[str, str] = {}
    for resource in show.resources:
        current = resource.initial_state or (resource.states[0] if resource.states else "idle")
        allowed = resource.states or ((current,) if current else ("idle",))
        states[resource.id] = ResourceState(resource.id, current, allowed)
        initials[resource.id] = current

    compiled = show.cue_map()
    cause: dict[str, int] = {}

    for cue in show.cues:
        start = starts.get(cue.id)
        statuses[cue.id] = CueStatus(cue.id, "pending", start, None, None)
        if start is None:
            findings.append(
                Finding(
                    code=CF7004_PENDING_MANUAL,
                    severity=Severity.WARNING,
                    message=f"cue {cue.id!r} was not given a GO",
                    subject_kind="cue",
                    subject_id=cue.id,
                )
            )
            push(0, "pending_manual", cue.id)
            continue
        push(start, "eligible", cue.id)

    while heap:
        _, item = heappop(heap)
        clock.advance_to(item.time_ms)
        cue = compiled[item.cue_id]
        if item.kind == "eligible":
            ev_seq = _emit(
                events,
                item.time_ms,
                "eligible",
                cue.id,
                item.sequence,
                cause.get(cue.id),
                (cue.id,),
                {},
            )
            cause[cue.id] = ev_seq
            if cue.id in fails and (fails[cue.id] is None or fails[cue.id] == item.time_ms):
                _fail_cue(
                    events,
                    findings,
                    statuses,
                    cue,
                    item.time_ms,
                    ev_seq,
                    started=False,
                )
                continue
            if cue.id in fails and fails[cue.id] is not None and fails[cue.id] > item.time_ms:  # type: ignore[operator]
                push(int(fails[cue.id]), "failed", cue.id, {"started": True})  # type: ignore[arg-type]
            started_ok, state_findings = _try_start(
                cue, states, item.time_ms, events, ev_seq, live_reservations
            )
            findings.extend(state_findings)
            if not started_ok:
                _fail_cue(
                    events,
                    findings,
                    statuses,
                    cue,
                    item.time_ms,
                    ev_seq,
                    started=False,
                    extra_code=CF4003_ILLEGAL_STATE,
                )
                continue
            end = item.time_ms + cue.duration_ms
            statuses[cue.id] = CueStatus(cue.id, "running", item.time_ms, end, None)
            _emit(
                events,
                item.time_ms,
                "started",
                cue.id,
                _next_seq(events, item.sequence),
                ev_seq,
                (cue.id,),
                {"duration_ms": cue.duration_ms},
            )
            push(end, "completed", cue.id)
        elif item.kind == "failed":
            _fail_cue(
                events,
                findings,
                statuses,
                cue,
                item.time_ms,
                cause.get(cue.id),
                started=True,
                reservations=live_reservations,
            )
        elif item.kind == "completed":
            status = statuses[cue.id]
            if status.status != "running":
                continue
            _release(live_reservations, events, cue, item.time_ms, cause.get(cue.id))
            statuses[cue.id] = CueStatus(cue.id, "completed", status.start_ms, item.time_ms, None)
            _emit(
                events,
                item.time_ms,
                "completed",
                cue.id,
                item.sequence,
                cause.get(cue.id),
                (cue.id,),
                {},
            )
        elif item.kind == "pending_manual":
            _emit(
                events,
                item.time_ms,
                "pending_manual",
                cue.id,
                item.sequence,
                None,
                (cue.id,),
                {},
            )

    capacities = {item.id: item.capacity for item in show.resources}
    findings.extend(detect_capacity_conflicts(tuple(live_reservations), capacities))

    instants = {
        cue_id: {
            "started": statuses[cue_id].start_ms,
            "visible": statuses[cue_id].start_ms,
            "completed": statuses[cue_id].end_ms,
            "failed": statuses[cue_id].fail_ms,
        }
        for cue_id in statuses
    }
    state_timeline = [
        (event.time_ms, event.sequence, event.details.get("resource", ""), event.details.get("to", ""))
        for event in events
        if event.kind == "state_changed"
    ]
    findings.extend(
        evaluate_assertions(
            list(show.assertions),
            instants,
            {key: states[key].current for key in states},
            state_timeline,
            initials,
        )
    )

    events_t = tuple(sorted(events, key=lambda event: event.sort_key()))
    statuses_t = tuple(statuses[cue_id] for cue_id in show.order)
    reservations_t = tuple(sorted(live_reservations, key=lambda item: item.sort_key()))
    findings_t = sort_findings(findings)
    resource_states = {key: states[key].current for key in sorted(states)}

    from cueforge.reports.canonical_json import canonical_dumps, sha256_text

    payload = {
        "compiled_digest": show.digest,
        "events": [event.as_dict() for event in events_t],
        "findings": [_finding_dict(item) for item in findings_t],
        "interventions": intervention_labels,
        "production_id": show.production_id,
        "resource_states": resource_states,
        "statuses": [
            {
                "cue_id": item.cue_id,
                "end_ms": item.end_ms,
                "fail_ms": item.fail_ms,
                "start_ms": item.start_ms,
                "status": item.status,
            }
            for item in statuses_t
        ],
    }
    digest = sha256_text(canonical_dumps(payload))
    return RehearsalResult(
        compiled=show,
        events=events_t,
        statuses=statuses_t,
        reservations=reservations_t,
        findings=findings_t,
        resource_states=resource_states,
        interventions=tuple(intervention_labels),
        digest=digest,
    )


def _unknown(cue_id: str) -> Finding:
    return Finding(
        code=CF7003_UNKNOWN_INTERVENTION,
        severity=Severity.ERROR,
        message=f"intervention refers to unknown cue {cue_id!r}",
        subject_kind="intervention",
        subject_id=cue_id,
    )


def _next_seq(events: list[SimulationEvent], fallback: int) -> int:
    return (events[-1].sequence + 1) if events else fallback + 1


def _emit(
    events: list[SimulationEvent],
    time_ms: int,
    kind: str,
    cue_id: str | None,
    sequence: int,
    cause_sequence: int | None,
    entities: tuple[str, ...],
    details: dict[str, str | int | bool],
) -> int:
    # Keep sequence unique and increasing.
    seq = sequence
    if events and seq <= events[-1].sequence:
        seq = events[-1].sequence + 1
    events.append(
        SimulationEvent(
            time_ms=time_ms,
            kind=kind,
            cue_id=cue_id,
            sequence=seq,
            cause_sequence=cause_sequence,
            entities=entities,
            details=details,
        )
    )
    return seq


def _try_start(
    cue: CompiledCue,
    states: dict[str, ResourceState],
    time_ms: int,
    events: list[SimulationEvent],
    cause: int,
    reservations: list[Reservation],
) -> tuple[bool, list[Finding]]:
    findings: list[Finding] = []
    required = {resource_id: state for resource_id, state in cue.requires_state}
    next_state = {cue.transition[0]: cue.transition[1]} if cue.transition else {}
    for resource_id, need in required.items():
        if resource_id not in states:
            continue
        new_state, state_findings = apply_transition(
            states[resource_id],
            cue_id=cue.id,
            required=need,
            next_state=None,
        )
        findings.extend(state_findings)
        if state_findings:
            return False, findings
        states[resource_id] = new_state
    if findings:
        return False, findings
    for resource_id, target in next_state.items():
        if resource_id not in states:
            continue
        new_state, state_findings = apply_transition(
            states[resource_id],
            cue_id=cue.id,
            required=None,
            next_state=target,
        )
        findings.extend(state_findings)
        if state_findings:
            return False, findings
        states[resource_id] = new_state
        _emit(
            events,
            time_ms,
            "state_changed",
            cue.id,
            _next_seq(events, cause),
            cause,
            (cue.id, resource_id),
            {"resource": resource_id, "to": target},
        )
    if cue.uses:
        interval = Interval(time_ms, time_ms + cue.duration_ms)
        for resource_id in cue.uses:
            reservations.append(Reservation(resource_id, cue.id, interval))
            _emit(
                events,
                time_ms,
                "resource_reserved",
                cue.id,
                _next_seq(events, cause),
                cause,
                (cue.id, resource_id),
                {"resource": resource_id, "end_ms": interval.end_ms},
            )
    return True, findings


def _release(
    reservations: list[Reservation],
    events: list[SimulationEvent],
    cue: CompiledCue,
    time_ms: int,
    cause: int | None,
) -> None:
    for resource_id in cue.uses:
        _emit(
            events,
            time_ms,
            "resource_released",
            cue.id,
            _next_seq(events, cause or 0),
            cause,
            (cue.id, resource_id),
            {"resource": resource_id},
        )
        # End time already stored on reservation; rewrite if we failed early.
        for index, item in enumerate(reservations):
            if item.cue_id == cue.id and item.resource_id == resource_id:
                reservations[index] = Reservation(
                    resource_id,
                    cue.id,
                    Interval(item.interval.start_ms, time_ms),
                )


def _fail_cue(
    events: list[SimulationEvent],
    findings: list[Finding],
    statuses: dict[str, CueStatus],
    cue: CompiledCue,
    time_ms: int,
    cause: int | None,
    *,
    started: bool,
    reservations: list[Reservation] | None = None,
    extra_code: str | None = None,
) -> None:
    prior = statuses[cue.id]
    statuses[cue.id] = CueStatus(
        cue.id,
        "failed",
        prior.start_ms if started else None,
        time_ms if started else None,
        time_ms,
    )
    if reservations is not None:
        _release(reservations, events, cue, time_ms, cause)
    _emit(
        events,
        time_ms,
        "failed",
        cue.id,
        _next_seq(events, cause or 0),
        cause,
        (cue.id,),
        {"started": started},
    )
    findings.append(
        Finding(
            code=extra_code or CF7002_CUE_FAILED,
            severity=Severity.ERROR,
            message=f"cue {cue.id!r} failed at {time_ms}ms",
            subject_kind="cue",
            subject_id=cue.id,
            witness={"time_ms": time_ms, "started": started},
        )
    )
