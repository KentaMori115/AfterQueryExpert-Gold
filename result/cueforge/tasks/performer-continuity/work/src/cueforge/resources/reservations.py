"""Half-open reservation intervals [start, end)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Interval:
    start_ms: int
    end_ms: int

    def __post_init__(self) -> None:
        if self.end_ms < self.start_ms:
            raise ValueError("interval end must be >= start")

    def overlaps(self, other: Interval) -> bool:
        """Boundary-touching intervals do not overlap."""
        return self.start_ms < other.end_ms and other.start_ms < self.end_ms

    def intersection(self, other: Interval) -> Interval | None:
        if not self.overlaps(other):
            return None
        return Interval(max(self.start_ms, other.start_ms), min(self.end_ms, other.end_ms))


@dataclass(frozen=True, slots=True)
class Reservation:
    resource_id: str
    cue_id: str
    interval: Interval

    def sort_key(self) -> tuple[int, int, str, str]:
        return (self.interval.start_ms, self.interval.end_ms, self.resource_id, self.cue_id)
