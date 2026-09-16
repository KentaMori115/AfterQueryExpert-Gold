"""Versioned public Pydantic models for authored productions."""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SUPPORTED_SCHEMA_VERSIONS = frozenset({1})
SUPPORTED_TIME_UNITS = frozenset({"ms"})


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", str_strip_whitespace=True)


class LocationDef(FrozenModel):
    x: object
    y: object


class PerformerDef(FrozenModel):
    initial_mark: str


class ResourceDef(FrozenModel):
    kind: str
    capacity: object = 1
    states: tuple[str, ...] | None = None
    initial_state: str | None = None


class RequirementDef(FrozenModel):
    resource: str
    state: str | None = None


class ActionDef(FrozenModel):
    preset: str | None = None
    play: str | None = None
    resource: str | None = None
    transition_to: str | None = None
    move: str | None = None
    from_mark: str | None = Field(default=None, alias="from")
    to: str | None = None
    maximum_speed: object | None = None

    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)


class TriggerDef(FrozenModel):
    at: object | None = None
    after: str | None = None
    on: str | None = None
    offset: object = 0
    manual: object | None = None

    @model_validator(mode="after")
    def exactly_one_kind(self) -> TriggerDef:
        flags = [
            self.at is not None,
            self.after is not None,
            self.on is not None,
            self.manual is True or self.manual == "true",
        ]
        if sum(1 for flag in flags if flag) != 1:
            raise ValueError(
                "trigger must set exactly one of at, after, on, or manual"
            )
        return self


class CueDef(FrozenModel):
    id: str
    department: str
    trigger: TriggerDef
    duration: object = 0
    action: ActionDef | None = None
    requires: tuple[RequirementDef, ...] = ()
    uses: tuple[str, ...] = ()
    notes: str | None = None

    @field_validator("uses", mode="before")
    @classmethod
    def _tuple_uses(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value

    @field_validator("requires", mode="before")
    @classmethod
    def _tuple_requires(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value


class AssertionDef(FrozenModel):
    expression: str


class DepartmentDef(FrozenModel):
    title: str | None = None


class Production(FrozenModel):
    version: int
    production: str
    time_unit: Literal["ms"] = "ms"
    resources: dict[str, ResourceDef] = Field(default_factory=dict)
    performers: dict[str, PerformerDef] = Field(default_factory=dict)
    locations: dict[str, LocationDef] = Field(default_factory=dict)
    events: dict[str, object] = Field(default_factory=dict)
    departments: dict[str, DepartmentDef] = Field(default_factory=dict)
    cues: tuple[CueDef, ...] = ()
    assertions: tuple[AssertionDef, ...] = ()
    source_path: str = "memory"

    @field_validator("cues", mode="before")
    @classmethod
    def _tuple_cues(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value

    @field_validator("assertions", mode="before")
    @classmethod
    def _tuple_assertions(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value

    def cue_ids(self) -> tuple[str, ...]:
        return tuple(cue.id for cue in self.cues)

    def semantic_dict(self) -> dict[str, Any]:
        """Canonical authored payload excluding filesystem location."""
        return {
            "assertions": [{"expression": item.expression} for item in self.assertions],
            "cues": [_cue_semantic(cue) for cue in self.cues],
            "departments": {
                name: dept.model_dump(mode="python") for name, dept in sorted(self.departments.items())
            },
            "events": {key: self.events[key] for key in sorted(self.events)},
            "locations": {
                name: {"x": loc.x, "y": loc.y} for name, loc in sorted(self.locations.items())
            },
            "performers": {
                name: {"initial_mark": perf.initial_mark}
                for name, perf in sorted(self.performers.items())
            },
            "production": self.production,
            "resources": {
                name: _resource_semantic(res) for name, res in sorted(self.resources.items())
            },
            "time_unit": self.time_unit,
            "version": self.version,
        }


def _resource_semantic(res: ResourceDef) -> dict[str, Any]:
    payload: dict[str, Any] = {"capacity": res.capacity, "kind": res.kind}
    if res.initial_state is not None:
        payload["initial_state"] = res.initial_state
    if res.states is not None:
        payload["states"] = list(res.states)
    return payload


def _cue_semantic(cue: CueDef) -> dict[str, Any]:
    trigger: dict[str, Any] = {}
    if cue.trigger.at is not None:
        trigger["at"] = cue.trigger.at
    if cue.trigger.after is not None:
        trigger["after"] = cue.trigger.after
    if cue.trigger.on is not None:
        trigger["on"] = cue.trigger.on
    if cue.trigger.manual is not None:
        trigger["manual"] = cue.trigger.manual
    trigger["offset"] = cue.trigger.offset
    action: dict[str, Any] | None = None
    if cue.action is not None:
        action = {}
        raw = cue.action.model_dump(by_alias=True, exclude_none=True)
        for key in sorted(raw):
            action[key] = raw[key]
    payload: dict[str, Any] = {
        "action": action,
        "department": cue.department,
        "duration": cue.duration,
        "id": cue.id,
        "requires": [req.model_dump() for req in cue.requires],
        "trigger": trigger,
        "uses": list(cue.uses),
    }
    if cue.notes is not None:
        payload["notes"] = cue.notes
    return payload


def empty_maps() -> Mapping[str, Any]:
    return {}
