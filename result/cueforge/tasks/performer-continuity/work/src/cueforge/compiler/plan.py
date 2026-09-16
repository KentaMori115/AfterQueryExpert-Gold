"""Compile a production into an immutable show plan."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from cueforge.compiler.graph import build_graph, cycle_findings, find_cycles
from cueforge.compiler.normalize import NormalizedNumbers, cue_uses, normalize_numbers
from cueforge.compiler.ordering import topological_order
from cueforge.compiler.triggers import NormalizedTrigger, normalize_trigger
from cueforge.compiler.validate import validate_production_shell
from cueforge.findings import Finding, Severity, sort_findings
from cueforge.movement.continuity import MoveRequest, ResolvedMove, resolve_moves
from cueforge.movement.geometry import Point
from cueforge.movement.travel import travel_time_ms
from cueforge.production.models import CueDef, Production
from cueforge.production.references import collect_reference_findings
from cueforge.reports.canonical_json import canonical_dumps, sha256_text
from cueforge.resources.capacity import detect_capacity_conflicts
from cueforge.resources.reservations import Interval, Reservation
from cueforge.timing.schedule import resolve_starts


@dataclass(frozen=True, slots=True)
class CompiledCue:
    id: str
    department: str
    trigger_kind: str
    event: str | None
    depends_on: tuple[str, ...]
    offset_ms: int
    start_ms: int | None
    duration_ms: int
    uses: tuple[str, ...]
    requires_state: tuple[tuple[str, str], ...]
    transition: tuple[str, str] | None
    action: Mapping[str, str | int]
    notes: str | None
    source_path: str

    def end_ms(self) -> int | None:
        if self.start_ms is None:
            return None
        return self.start_ms + self.duration_ms


@dataclass(frozen=True, slots=True)
class CompiledResource:
    id: str
    kind: str
    capacity: int
    states: tuple[str, ...] | None
    initial_state: str | None


@dataclass(frozen=True, slots=True)
class CompiledShow:
    production_id: str
    schema_version: int
    time_unit: str
    cues: tuple[CompiledCue, ...]
    resources: tuple[CompiledResource, ...]
    performers: Mapping[str, str]
    locations: Mapping[str, tuple[int, int]]
    events: Mapping[str, int]
    assertions: tuple[str, ...]
    order: tuple[str, ...]
    reservations: tuple[Reservation, ...]
    digest: str
    source_path: str

    def cue_map(self) -> dict[str, CompiledCue]:
        return {cue.id: cue for cue in self.cues}

    def resource_map(self) -> dict[str, CompiledResource]:
        return {item.id: item for item in self.resources}

    def semantic_dict(self) -> dict[str, Any]:
        return {
            "assertions": list(self.assertions),
            "cues": [_compiled_cue_dict(cue) for cue in self.cues],
            "digest": self.digest,
            "events": {key: self.events[key] for key in sorted(self.events)},
            "locations": {
                name: {"x": xy[0], "y": xy[1]} for name, xy in sorted(self.locations.items())
            },
            "order": list(self.order),
            "performers": {name: self.performers[name] for name in sorted(self.performers)},
            "production_id": self.production_id,
            "reservations": [
                {
                    "cue_id": item.cue_id,
                    "end_ms": item.interval.end_ms,
                    "resource_id": item.resource_id,
                    "start_ms": item.interval.start_ms,
                }
                for item in self.reservations
            ],
            "resources": [
                {
                    "capacity": item.capacity,
                    "id": item.id,
                    "initial_state": item.initial_state,
                    "kind": item.kind,
                    "states": list(item.states) if item.states is not None else None,
                }
                for item in self.resources
            ],
            "schema_version": self.schema_version,
            "time_unit": self.time_unit,
        }


def _compiled_cue_dict(cue: CompiledCue) -> dict[str, Any]:
    return {
        "action": {key: cue.action[key] for key in sorted(cue.action)},
        "department": cue.department,
        "depends_on": list(cue.depends_on),
        "duration_ms": cue.duration_ms,
        "id": cue.id,
        "offset_ms": cue.offset_ms,
        "requires_state": [{"resource": a, "state": b} for a, b in cue.requires_state],
        "start_ms": cue.start_ms,
        "transition": (
            {"resource": cue.transition[0], "to": cue.transition[1]}
            if cue.transition
            else None
        ),
        "trigger_kind": cue.trigger_kind,
        "event": cue.event,
        "uses": list(cue.uses),
    }


def _action_map(cue: CueDef, move: ResolvedMove | None = None) -> dict[str, str | int]:
    """The authored action, with ``from`` replaced by where the move really departs."""
    if cue.action is None:
        return {}
    payload: dict[str, str | int] = {}
    raw = cue.action.model_dump(by_alias=True, exclude_none=True)
    for key, value in raw.items():
        if isinstance(value, (str, int)):
            payload[str(key)] = value
        else:
            payload[str(key)] = str(value)
    if move is not None and move.from_mark is not None:
        payload["from"] = move.from_mark
    return payload


def _move_duration(
    cue: CueDef, numbers: NormalizedNumbers, from_mark: str | None = None
) -> tuple[int | None, list[Finding]]:
    """Travel time of a move departing from ``from_mark``, or None without one."""
    findings: list[Finding] = []
    action = cue.action
    if action is None or action.move is None:
        return None, findings
    if action.to is None:
        from cueforge.codes import CF5004_BAD_MOVE

        findings.append(
            Finding(
                code=CF5004_BAD_MOVE,
                severity=Severity.ERROR,
                message=f"cue {cue.id!r} move requires to",
                subject_kind="cue",
                subject_id=cue.id,
            )
        )
        return None, findings
    if cue.id not in numbers.speeds:
        from cueforge.codes import CF5004_BAD_MOVE

        findings.append(
            Finding(
                code=CF5004_BAD_MOVE,
                severity=Severity.ERROR,
                message=f"cue {cue.id!r} move requires maximum_speed",
                subject_kind="cue",
                subject_id=cue.id,
            )
        )
        return None, findings
    if from_mark is None:
        return None, findings
    start_xy = numbers.location_xy.get(from_mark)
    end_xy = numbers.location_xy.get(action.to)
    if start_xy is None or end_xy is None:
        return None, findings
    travel = travel_time_ms(
        Point(*start_xy),
        Point(*end_xy),
        numbers.speeds[cue.id],
    )
    return travel, findings


def _move_requests(production: Production, starts: Mapping[str, int | None]) -> list[MoveRequest]:
    """Every move cue with the start the schedule resolved for it."""
    requests: list[MoveRequest] = []
    for cue in production.cues:
        action = cue.action
        if action is None or action.move is None or action.to is None:
            continue
        requests.append(
            MoveRequest(
                cue_id=cue.id,
                performer=action.move,
                to=action.to,
                stated_from=action.from_mark,
                start_ms=starts.get(cue.id),
            )
        )
    return requests


def _placed_duration(authored: int, travel: int | None) -> int:
    """The compiled duration of a move: travel when nothing was authored."""
    if travel is not None and authored == 0:
        return travel
    return authored


def _resolve_movement(
    production: Production,
    numbers: NormalizedNumbers,
    starts: Mapping[str, int | None],
) -> tuple[dict[str, ResolvedMove], list[Finding]]:
    """Where every move departs from, following each performer in start order."""
    cue_by_id = {cue.id: cue for cue in production.cues}

    def duration_for(move: MoveRequest, from_mark: str | None) -> tuple[int, list[Finding]]:
        cue = cue_by_id[move.cue_id]
        travel, _ = _move_duration(cue, numbers, from_mark)
        return _placed_duration(numbers.durations.get(cue.id, 0), travel), []

    initial_marks = {name: perf.initial_mark for name, perf in production.performers.items()}
    return resolve_moves(_move_requests(production, starts), initial_marks, duration_for)


def compile_production_document(
    production: Production,
) -> tuple[CompiledShow | None, tuple[Finding, ...]]:
    findings: list[Finding] = []
    findings.extend(validate_production_shell(production))
    findings.extend(collect_reference_findings(production))
    numbers, number_findings = normalize_numbers(production)
    findings.extend(number_findings)

    triggers: dict[str, NormalizedTrigger] = {}
    for cue in production.cues:
        trigger, trigger_findings = normalize_trigger(cue)
        findings.extend(trigger_findings)
        if trigger is not None:
            triggers[cue.id] = trigger

    if any(item.severity == Severity.ERROR for item in findings) or len(triggers) != len(
        production.cues
    ):
        return None, sort_findings(findings)

    graph, graph_findings = build_graph(triggers)
    findings.extend(graph_findings)
    cycles = find_cycles(graph)
    findings.extend(cycle_findings(cycles))
    if cycles or any(item.severity == Severity.ERROR for item in findings):
        return None, sort_findings(findings)

    order = topological_order(graph)
    schedule, schedule_findings = resolve_starts(triggers, order, numbers.events)
    findings.extend(schedule_findings)

    compiled_cues: list[CompiledCue] = []
    reservations: list[Reservation] = []
    cue_by_id = {cue.id: cue for cue in production.cues}
    moves, movement_findings = _resolve_movement(production, numbers, schedule.starts)
    findings.extend(movement_findings)

    for cue_id in order:
        cue = cue_by_id[cue_id]
        trigger = triggers[cue_id]
        move = moves.get(cue_id)
        travel, move_findings = _move_duration(
            cue, numbers, None if move is None else move.from_mark
        )
        findings.extend(move_findings)
        authored = numbers.durations.get(cue_id, 0)
        duration = authored
        if travel is not None:
            if authored == 0:
                duration = travel
            elif authored < travel:
                from cueforge.codes import CF5001_UNREACHABLE_MARK

                findings.append(
                    Finding(
                        code=CF5001_UNREACHABLE_MARK,
                        severity=Severity.ERROR,
                        message=(
                            f"cue {cue.id!r} duration {authored}ms is shorter than "
                            f"travel time {travel}ms"
                        ),
                        subject_kind="cue",
                        subject_id=cue.id,
                        witness={"duration_ms": authored, "travel_ms": travel},
                    )
                )
            else:
                duration = authored
        requires_state = tuple(
            (req.resource, req.state) for req in cue.requires if req.state is not None
        )
        transition: tuple[str, str] | None = None
        if cue.action is not None and cue.action.resource and cue.action.transition_to:
            transition = (cue.action.resource, cue.action.transition_to)
        start = schedule.starts.get(cue_id)
        uses = cue_uses(cue)
        compiled = CompiledCue(
            id=cue.id,
            department=cue.department,
            trigger_kind=trigger.kind,
            event=trigger.event,
            depends_on=(trigger.depends_on,) if trigger.depends_on else (),
            offset_ms=trigger.offset_ms,
            start_ms=start,
            duration_ms=duration,
            uses=uses,
            requires_state=requires_state,
            transition=transition,
            action=_action_map(cue, move),
            notes=cue.notes,
            source_path=production.source_path,
        )
        compiled_cues.append(compiled)
        if start is not None and uses:
            interval = Interval(start, start + duration)
            for resource_id in uses:
                reservations.append(Reservation(resource_id, cue.id, interval))

    reservations_t = tuple(sorted(reservations, key=lambda item: item.sort_key()))
    capacities = {
        name: numbers.capacities.get(name, 1) for name in production.resources
    }
    findings.extend(detect_capacity_conflicts(reservations_t, capacities))

    resources = tuple(
        CompiledResource(
            id=name,
            kind=item.kind,
            capacity=numbers.capacities.get(name, 1),
            states=item.states,
            initial_state=item.initial_state,
        )
        for name, item in sorted(production.resources.items())
    )

    # Digest excludes itself; hash the rest of the semantic compiled payload.
    skeleton = {
        "assertions": [item.expression for item in production.assertions],
        "cues": [_compiled_cue_dict(cue) for cue in compiled_cues],
        "events": {key: numbers.events[key] for key in sorted(numbers.events)},
        "locations": {
            name: {"x": xy[0], "y": xy[1]} for name, xy in sorted(numbers.location_xy.items())
        },
        "order": list(order),
        "performers": {
            name: perf.initial_mark for name, perf in sorted(production.performers.items())
        },
        "production_id": production.production,
        "reservations": [
            {
                "cue_id": item.cue_id,
                "end_ms": item.interval.end_ms,
                "resource_id": item.resource_id,
                "start_ms": item.interval.start_ms,
            }
            for item in reservations_t
        ],
        "resources": [
            {
                "capacity": item.capacity,
                "id": item.id,
                "initial_state": item.initial_state,
                "kind": item.kind,
                "states": list(item.states) if item.states is not None else None,
            }
            for item in resources
        ],
        "schema_version": production.version,
        "time_unit": production.time_unit,
    }
    digest = sha256_text(canonical_dumps(skeleton))

    show = CompiledShow(
        production_id=production.production,
        schema_version=production.version,
        time_unit=production.time_unit,
        cues=tuple(compiled_cues),
        resources=resources,
        performers={name: perf.initial_mark for name, perf in production.performers.items()},
        locations=numbers.location_xy,
        events=numbers.events,
        assertions=tuple(item.expression for item in production.assertions),
        order=order,
        reservations=reservations_t,
        digest=digest,
        source_path=production.source_path,
    )
    return show, sort_findings(findings)
