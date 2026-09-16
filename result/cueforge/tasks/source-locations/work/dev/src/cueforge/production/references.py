"""Cross-reference checks for authored productions."""

from __future__ import annotations

from cueforge.assertions.check import check_assertions
from cueforge.codes import CF1001_DUPLICATE_ID, CF1002_MISSING_REF, CF4004_UNKNOWN_RESOURCE
from cueforge.findings import Finding, Severity, SourceRef
from cueforge.identifiers import identifier_finding, is_valid_identifier
from cueforge.production.models import Production
from cueforge.production.source_map import SourceMap, located


def collect_reference_findings(production: Production) -> list[Finding]:
    findings: list[Finding] = []
    seen_cues: dict[str, int] = {}
    positions: SourceMap | None = production.source_map

    def value(*path: str | int) -> SourceRef | None:
        return positions.value(path) if positions is not None else None

    def key(*path: str | int) -> SourceRef | None:
        return positions.key(path) if positions is not None else None

    for section, kind in (
        ("resources", "resource"),
        ("performers", "performer"),
        ("locations", "location"),
        ("events", "event"),
    ):
        for name in getattr(production, section):
            if not is_valid_identifier(name):
                findings.append(
                    located(identifier_finding(kind, name, production.source_path), key(section, name))
                )

    for index, cue in enumerate(production.cues):
        if not is_valid_identifier(cue.id):
            findings.append(
                located(identifier_finding("cue", cue.id, production.source_path), value("cues", index, "id"))
            )
        if cue.id in seen_cues:
            findings.append(
                located(Finding(
                    code=CF1001_DUPLICATE_ID,
                    severity=Severity.ERROR,
                    message=f"duplicate cue id {cue.id!r}",
                    subject_kind="cue",
                    subject_id=cue.id,
                    witness={"first_index": seen_cues[cue.id], "second_index": index},
                ), value("cues", index, "id"))
            )
        else:
            seen_cues[cue.id] = index

        if cue.trigger.after is not None and cue.trigger.after not in seen_cues and not any(
            other.id == cue.trigger.after for other in production.cues
        ):
            findings.append(
                located(Finding(
                    code=CF1002_MISSING_REF,
                    severity=Severity.ERROR,
                    message=f"cue {cue.id!r} refers to missing cue {cue.trigger.after!r}",
                    subject_kind="cue",
                    subject_id=cue.id,
                    witness={"missing": cue.trigger.after, "field": "after"},
                ), value("cues", index, "trigger", "after"))
            )
        if cue.trigger.on is not None and cue.trigger.on not in production.events:
            findings.append(
                located(Finding(
                    code=CF1002_MISSING_REF,
                    severity=Severity.ERROR,
                    message=f"cue {cue.id!r} refers to missing event {cue.trigger.on!r}",
                    subject_kind="cue",
                    subject_id=cue.id,
                    witness={"missing": cue.trigger.on, "field": "on"},
                ), value("cues", index, "trigger", "on"))
            )
        for position, resource_id in enumerate(cue.uses):
            if resource_id not in production.resources:
                findings.append(
                    located(Finding(
                        code=CF4004_UNKNOWN_RESOURCE,
                        severity=Severity.ERROR,
                        message=f"cue {cue.id!r} uses unknown resource {resource_id!r}",
                        subject_kind="cue",
                        subject_id=cue.id,
                        witness={"resource": resource_id},
                    ), value("cues", index, "uses", position))
                )
        for position, req in enumerate(cue.requires):
            if req.resource not in production.resources:
                findings.append(
                    located(Finding(
                        code=CF4004_UNKNOWN_RESOURCE,
                        severity=Severity.ERROR,
                        message=f"cue {cue.id!r} requires unknown resource {req.resource!r}",
                        subject_kind="cue",
                        subject_id=cue.id,
                        witness={"resource": req.resource},
                    ), value("cues", index, "requires", position, "resource"))
                )
        action = cue.action
        if action is not None:
            if action.resource is not None and action.resource not in production.resources:
                findings.append(
                    located(Finding(
                        code=CF4004_UNKNOWN_RESOURCE,
                        severity=Severity.ERROR,
                        message=f"cue {cue.id!r} action refers to unknown resource {action.resource!r}",
                        subject_kind="cue",
                        subject_id=cue.id,
                        witness={"resource": action.resource},
                    ), value("cues", index, "action", "resource"))
                )
            if action.move is not None and action.move not in production.performers:
                findings.append(
                    located(Finding(
                        code="CF5003",
                        severity=Severity.ERROR,
                        message=f"cue {cue.id!r} moves unknown performer {action.move!r}",
                        subject_kind="cue",
                        subject_id=cue.id,
                        witness={"performer": action.move},
                    ), value("cues", index, "action", "move"))
                )
            for field_name, mark in (("from", action.from_mark), ("to", action.to)):
                if mark is not None and mark not in production.locations:
                    findings.append(
                        located(Finding(
                            code="CF5002",
                            severity=Severity.ERROR,
                            message=f"cue {cue.id!r} refers to unknown location {mark!r}",
                            subject_kind="cue",
                            subject_id=cue.id,
                            witness={"location": mark},
                        ), value("cues", index, "action", field_name))
                    )
            if action.from_mark is not None and action.move is not None:
                performer = production.performers.get(action.move)
                if performer is not None and performer.initial_mark not in production.locations:
                    findings.append(
                        located(Finding(
                            code="CF5002",
                            severity=Severity.ERROR,
                            message=(
                                f"performer {action.move!r} initial_mark "
                                f"{performer.initial_mark!r} is unknown"
                            ),
                            subject_kind="performer",
                            subject_id=action.move,
                            witness={"location": performer.initial_mark},
                        ), value("performers", action.move, "initial_mark"))
                    )

    for index, finding in check_assertions(production):
        findings.append(located(finding, value("assertions", index, "expression")))

    return findings
