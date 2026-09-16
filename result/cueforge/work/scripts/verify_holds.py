#!/usr/bin/env python3
"""Rehearse the hold examples and check the invariants every hold obeys."""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from cueforge.api import compile_production, load_production, rehearse

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = [
    ROOT / "examples" / "holds" / "shared_wall.yaml",
    ROOT / "examples" / "holds" / "revolve_late.yaml",
    ROOT / "examples" / "invalid-productions" / "overlap.yaml",
]


def check(path: Path) -> list[str]:
    problems: list[str] = []
    loaded = load_production(path)
    if loaded.value is None:
        return [f"load failed: {path}"]
    compiled = compile_production(loaded.value)
    if compiled.value is None:
        return [f"compile failed: {path}"]
    show = compiled.value
    result = rehearse(show)
    capacity = {item.id: item.capacity for item in show.resources}

    # No instant may see more holders on a resource than it has slots. Every
    # reservation is half-open, so only the start instants need checking.
    by_resource: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for item in result.reservations:
        by_resource[item.resource_id].append((item.interval.start_ms, item.interval.end_ms))
    for resource_id, spans in by_resource.items():
        for start, _end in spans:
            live = sum(1 for other_start, other_end in spans if other_start <= start < other_end)
            if live > capacity.get(resource_id, 1):
                problems.append(f"{path.name}: {resource_id} has {live} holders at {start}ms")

    planned_seen: list[tuple[int, str]] = []
    for entry in result.semantic_dict()["holds"]:
        if entry["start_ms"] < entry["planned_ms"]:
            problems.append(f"{path.name}: {entry['cue_id']} started before it was called")
        if entry["held_ms"] != entry["start_ms"] - entry["planned_ms"]:
            problems.append(f"{path.name}: {entry['cue_id']} held_ms does not add up")
        if not entry["resources"] or entry["resources"] != sorted(entry["resources"]):
            problems.append(f"{path.name}: {entry['cue_id']} resources are not sorted")
        planned_seen.append((entry["planned_ms"], entry["cue_id"]))
    if planned_seen != sorted(planned_seen):
        problems.append(f"{path.name}: holds are not ordered by planned instant then id")

    late = {item.subject_id for item in result.findings if item.code == "CF7001"}
    listed = {entry["cue_id"] for entry in result.semantic_dict()["holds"]}
    if late != listed:
        problems.append(f"{path.name}: CF7001 findings {sorted(late)} do not match holds {sorted(listed)}")
    for item in result.findings:
        if item.code in {"CF4001", "CF4002"}:
            problems.append(f"{path.name}: rehearsal still double-books ({item.code})")
    return problems


def main() -> int:
    failures: list[str] = []
    for path in EXAMPLES:
        failures.extend(check(path))
    for line in failures:
        print(line, file=sys.stderr)
    if failures:
        return 1
    print("holds ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
