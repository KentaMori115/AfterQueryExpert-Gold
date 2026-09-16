"""Integer millisecond instants."""

from __future__ import annotations

from dataclasses import dataclass

INT64_MIN = -(2**63)
INT64_MAX = 2**63 - 1


@dataclass(frozen=True, slots=True)
class Instant:
    """A virtual-time instant in signed milliseconds."""

    ms: int

    def __post_init__(self) -> None:
        if not isinstance(self.ms, int) or isinstance(self.ms, bool):
            raise TypeError("instant must be an int")
        if self.ms < INT64_MIN or self.ms > INT64_MAX:
            raise OverflowError("instant outside signed 64-bit range")

    def add(self, delta_ms: int) -> Instant:
        total = self.ms + delta_ms
        if total < INT64_MIN or total > INT64_MAX:
            raise OverflowError("instant arithmetic overflow")
        return Instant(total)

    def __lt__(self, other: Instant) -> bool:
        return self.ms < other.ms

    def __le__(self, other: Instant) -> bool:
        return self.ms <= other.ms
