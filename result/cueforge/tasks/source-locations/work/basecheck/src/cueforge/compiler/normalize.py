"""Normalize authored numeric fields after Pydantic parse."""

from __future__ import annotations

from dataclasses import dataclass

from cueforge.findings import Finding
from cueforge.production.models import CueDef, Production
from cueforge.timing.parse import parse_duration_ms, parse_int64, parse_speed_milli


@dataclass(frozen=True, slots=True)
class NormalizedNumbers:
    durations: dict[str, int]
    events: dict[str, int]
    location_xy: dict[str, tuple[int, int]]
    capacities: dict[str, int]
    speeds: dict[str, int]


def normalize_numbers(production: Production) -> tuple[NormalizedNumbers, list[Finding]]:
    findings: list[Finding] = []
    durations: dict[str, int] = {}
    events: dict[str, int] = {}
    location_xy: dict[str, tuple[int, int]] = {}
    capacities: dict[str, int] = {}
    speeds: dict[str, int] = {}

    for event_id, raw in production.events.items():
        value, finding = parse_int64(raw, field=f"events.{event_id}")
        if finding is not None:
            findings.append(finding)
        else:
            assert value is not None
            events[event_id] = value

    for name, location in production.locations.items():
        x, x_finding = parse_int64(location.x, field=f"locations.{name}.x")
        y, y_finding = parse_int64(location.y, field=f"locations.{name}.y")
        if x_finding is not None:
            findings.append(x_finding)
        if y_finding is not None:
            findings.append(y_finding)
        if x is not None and y is not None:
            location_xy[name] = (x, y)

    for name, resource in production.resources.items():
        cap, finding = parse_int64(resource.capacity, field=f"resources.{name}.capacity")
        if finding is not None:
            findings.append(finding)
        elif cap is not None and cap < 1:
            from cueforge.codes import CF2001_INVALID_TIME
            from cueforge.findings import Severity

            findings.append(
                Finding(
                    code=CF2001_INVALID_TIME,
                    severity=Severity.ERROR,
                    message=f"resource {name!r} capacity must be >= 1",
                    subject_kind="resource",
                    subject_id=name,
                    witness={"capacity": cap},
                )
            )
        elif cap is not None:
            capacities[name] = cap

    for cue in production.cues:
        duration, finding = parse_duration_ms(cue.duration, field=f"{cue.id}.duration")
        if finding is not None:
            findings.append(finding)
        else:
            assert duration is not None
            durations[cue.id] = duration
        action = cue.action
        if action is not None and action.maximum_speed is not None:
            speed, speed_finding = parse_speed_milli(
                action.maximum_speed, field=f"{cue.id}.maximum_speed"
            )
            if speed_finding is not None:
                findings.append(speed_finding)
            elif speed is not None:
                speeds[cue.id] = speed

    return (
        NormalizedNumbers(
            durations=durations,
            events=events,
            location_xy=location_xy,
            capacities=capacities,
            speeds=speeds,
        ),
        findings,
    )


def cue_uses(cue: CueDef) -> tuple[str, ...]:
    names = list(cue.uses)
    if cue.action is not None and cue.action.resource is not None:
        if cue.action.resource not in names:
            names.append(cue.action.resource)
    for req in cue.requires:
        if req.resource not in names:
            names.append(req.resource)
    return tuple(names)
