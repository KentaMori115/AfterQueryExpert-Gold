"""Resource slots and hold records for the virtual-time rehearsal.

A resource with ``capacity`` slots can be held by that many started cues at
once. A cue whose turn comes while every slot of one of its resources is
taken does not start; it holds, and the scheduler starts it at the first
instant a slot on each of its resources is free. ``SlotLedger`` keeps the
live picture of who holds what, ``HoldQueue`` keeps the cues that are waiting
in the order they are entitled to a slot, and ``HoldRecord`` is the public
account of one cue that started later than it was called.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from cueforge.codes import CF7001_LATE_CUE
from cueforge.findings import Finding, Severity


@dataclass(frozen=True, slots=True)
class HoldRecord:
    """One cue that was called at ``planned_ms`` and started at ``start_ms``."""

    cue_id: str
    planned_ms: int
    start_ms: int
    resources: tuple[str, ...]

    @property
    def held_ms(self) -> int:
        return self.start_ms - self.planned_ms

    def sort_key(self) -> tuple[int, str]:
        return (self.planned_ms, self.cue_id)

    def as_dict(self) -> dict[str, Any]:
        return {
            "cue_id": self.cue_id,
            "held_ms": self.held_ms,
            "planned_ms": self.planned_ms,
            "resources": list(self.resources),
            "start_ms": self.start_ms,
        }

    def finding(self) -> Finding:
        joined = ",".join(self.resources)
        return Finding(
            code=CF7001_LATE_CUE,
            severity=Severity.WARNING,
            message=(
                f"cue {self.cue_id!r} held {self.held_ms}ms for {joined}: "
                f"called at {self.planned_ms}ms, started at {self.start_ms}ms"
            ),
            subject_kind="cue",
            subject_id=self.cue_id,
            witness={
                "planned_ms": self.planned_ms,
                "start_ms": self.start_ms,
                "held_ms": self.held_ms,
                "resources": joined,
            },
        )


class SlotLedger:
    """Live slot accounting: which started cues hold which resource now.

    A holder is counted from the instant it starts until the instant it
    releases, which is its completion or its failure. Releases are applied
    before the queue is retried at the same instant, so an interval that ends
    at ``t`` never blocks a cue called at ``t``.
    """

    def __init__(self, capacities: Mapping[str, int]) -> None:
        self._capacity = {name: max(1, int(cap)) for name, cap in capacities.items()}
        self._holders: dict[str, list[str]] = {name: [] for name in self._capacity}

    def capacity(self, resource_id: str) -> int:
        return self._capacity.get(resource_id, 1)

    def holders(self, resource_id: str) -> tuple[str, ...]:
        return tuple(self._holders.get(resource_id, ()))

    def free_slots(self, resource_id: str) -> int:
        return self.capacity(resource_id) - len(self._holders.get(resource_id, ()))

    def busy(self, resources: tuple[str, ...]) -> tuple[str, ...]:
        """The resources among ``resources`` that have no free slot, sorted."""
        return tuple(sorted({name for name in resources if self.free_slots(name) <= 0}))

    def acquire(self, cue_id: str, resources: tuple[str, ...]) -> None:
        for name in resources:
            self._holders.setdefault(name, []).append(cue_id)

    def release(self, cue_id: str, resources: tuple[str, ...]) -> tuple[str, ...]:
        """Drop ``cue_id`` from every listed resource; return the ones it held."""
        released: list[str] = []
        for name in resources:
            holders = self._holders.get(name)
            if holders is not None and cue_id in holders:
                holders.remove(cue_id)
                released.append(name)
        return tuple(released)


@dataclass(frozen=True, slots=True)
class HoldEntry:
    """A cue waiting for a slot: called at ``planned_ms``, blocked by ``busy``."""

    planned_ms: int
    cue_id: str
    busy: tuple[str, ...]

    def sort_key(self) -> tuple[int, str]:
        return (self.planned_ms, self.cue_id)


class HoldQueue:
    """Cues that are holding, in the order they are entitled to a free slot:
    earlier planned instant first, then smaller cue id."""

    def __init__(self) -> None:
        self._entries: dict[str, HoldEntry] = {}

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, cue_id: str) -> bool:
        return cue_id in self._entries

    def add(self, planned_ms: int, cue_id: str, busy: tuple[str, ...]) -> HoldEntry:
        entry = HoldEntry(planned_ms, cue_id, busy)
        self._entries[cue_id] = entry
        return entry

    def remove(self, cue_id: str) -> HoldEntry | None:
        return self._entries.pop(cue_id, None)

    def ordered(self) -> Iterator[HoldEntry]:
        """Entries in entitlement order, safe against removal while iterating."""
        for entry in sorted(self._entries.values(), key=lambda item: item.sort_key()):
            if entry.cue_id in self._entries:
                yield entry


def hold_findings(records: tuple[HoldRecord, ...] | list[HoldRecord]) -> list[Finding]:
    return [record.finding() for record in records]
