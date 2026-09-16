"""Detect exclusive and capacity-limited reservation conflicts."""

from __future__ import annotations

from collections import defaultdict

from cueforge.codes import CF4001_RESERVATION_CONFLICT, CF4002_CAPACITY_EXCEEDED
from cueforge.findings import Finding, Severity
from cueforge.resources.reservations import Reservation


def detect_capacity_conflicts(
    reservations: tuple[Reservation, ...] | list[Reservation],
    capacities: dict[str, int],
) -> list[Finding]:
    findings: list[Finding] = []
    by_resource: dict[str, list[Reservation]] = defaultdict(list)
    for reservation in reservations:
        by_resource[reservation.resource_id].append(reservation)

    for resource_id, items in sorted(by_resource.items()):
        capacity = capacities.get(resource_id, 1)
        ordered = sorted(items, key=lambda item: item.sort_key())
        for index, left in enumerate(ordered):
            overlap_ids = [left.cue_id]
            overlap_start = left.interval.start_ms
            overlap_end = left.interval.end_ms
            for right in ordered[index + 1 :]:
                if not left.interval.overlaps(right.interval):
                    continue
                overlap_ids.append(right.cue_id)
                inter = left.interval.intersection(right.interval)
                if inter is not None:
                    overlap_start = min(overlap_start, inter.start_ms)
                    overlap_end = max(overlap_end, inter.end_ms)
            claimants = tuple(sorted(set(overlap_ids)))
            if len(claimants) > capacity:
                code = (
                    CF4001_RESERVATION_CONFLICT
                    if capacity == 1
                    else CF4002_CAPACITY_EXCEEDED
                )
                findings.append(
                    Finding(
                        code=code,
                        severity=Severity.ERROR,
                        message=(
                            f"resource {resource_id!r} capacity {capacity} exceeded by "
                            f"{', '.join(claimants)}"
                        ),
                        subject_kind="resource",
                        subject_id=resource_id,
                        witness={
                            "capacity": capacity,
                            "cues": ",".join(claimants),
                            "start_ms": overlap_start if len(claimants) > 1 else left.interval.start_ms,
                            "end_ms": overlap_end if len(claimants) > 1 else left.interval.end_ms,
                        },
                    )
                )
    # The nested loop can emit a finding per left-item; collapse duplicates.
    unique: dict[tuple[object, ...], Finding] = {}
    for finding in findings:
        key = (
            finding.code,
            finding.subject_id,
            finding.witness.get("cues"),
            finding.witness.get("start_ms"),
            finding.witness.get("end_ms"),
        )
        unique[key] = finding
    return list(unique.values())
