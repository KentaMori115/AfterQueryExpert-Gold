"""Attach source positions to compile findings raised deeper in the pipeline.

The compiler's numeric, trigger, graph and reservation checks describe what
they found through ``subject_kind``, ``subject_id`` and ``witness``.  Those
say which authored node the finding is about; this module turns that into a
:class:`SourceRef` using the production's :class:`SourceMap`, so the rules
live in one place and every producer keeps its own shape.
"""

from __future__ import annotations

from cueforge.findings import Finding, SourceRef
from cueforge.production.models import Production
from cueforge.production.source_map import NodePath, SourceMap, located

# Fields the compiler names as "<cue id>.<field>", and where each one sits.
_CUE_FIELDS: dict[str, tuple[str, ...]] = {
    "duration": ("duration",),
    "offset": ("trigger", "offset"),
    "at": ("trigger", "at"),
    "maximum_speed": ("action", "maximum_speed"),
}


def _field_path(field: str, cue_index: dict[str, int]) -> NodePath | None:
    """Turn a compiler field name such as ``lx_21.offset`` into a node path."""
    parts = field.split(".")
    if len(parts) == 2 and parts[0] in cue_index and parts[1] in _CUE_FIELDS:
        return ("cues", cue_index[parts[0]], *_CUE_FIELDS[parts[1]])
    if parts[0] == "events" and len(parts) == 2:
        return ("events", parts[1])
    if parts[0] in {"locations", "resources"} and len(parts) == 3:
        return (parts[0], parts[1], parts[2])
    return None


def _trigger_path(finding: Finding, cue_index: dict[str, int], *tail: str) -> NodePath | None:
    cue_id = finding.subject_id
    if cue_id is None or cue_id not in cue_index:
        return None
    return ("cues", cue_index[cue_id], "trigger", *tail)


def locate_finding(finding: Finding, production: Production) -> Finding:
    """Return ``finding`` pointing at the authored node it is about, when one exists."""
    positions: SourceMap | None = production.source_map
    if positions is None or finding.source is not None:
        return finding
    cue_index: dict[str, int] = {}
    for index, cue in enumerate(production.cues):
        cue_index.setdefault(cue.id, index)
    code, kind, subject = finding.code, finding.subject_kind, finding.subject_id
    ref: SourceRef | None = None
    path: NodePath | None = None

    if kind == "time":
        field = subject if subject else finding.message.split(" ", 1)[0]
        path = _field_path(field, cue_index)
    elif code == "CF2001" and kind == "resource" and subject is not None:
        path = ("resources", subject, "capacity")
    elif code == "CF1004":
        path = ("version",)
    elif code == "CF2005":
        path = ("time_unit",)
    elif code == "CF3006":
        path = ("cues",)
    elif code == "CF4005" and subject is not None:
        path = ("resources", subject, "initial_state")
    elif code in {"CF3001", "CF3003"}:
        path = _trigger_path(finding, cue_index, "after")
    elif code == "CF3002":
        cycle = str(finding.witness.get("cycle", "")).split(",")
        first = cycle[0] if cycle and cycle[0] else subject
        if first in cue_index:
            path = ("cues", cue_index[first], "trigger", "after")
    elif code in {"CF3004", "CF2004"} and kind == "cue":
        path = _trigger_path(finding, cue_index)
    elif code in {"CF4001", "CF4002"} and subject is not None:
        ref = positions.key(("resources", subject))
    elif code == "CF5001" and subject in cue_index:
        path = ("cues", cue_index[subject], "duration")
    elif code == "CF5004" and subject in cue_index:
        path = ("cues", cue_index[subject], "action")

    if ref is None and path is not None:
        ref = positions.value(path) if path[-1] == "cues" or len(path) == 1 else positions.nearest(path)
    return located(finding, ref)


def locate_findings(findings: list[Finding] | tuple[Finding, ...], production: Production) -> list[Finding]:
    return [locate_finding(item, production) for item in findings]
