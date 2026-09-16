"""Integer virtual clock."""

from __future__ import annotations

from dataclasses import dataclass

from cueforge.timing.instants import INT64_MAX, INT64_MIN


@dataclass
class VirtualClock:
    now_ms: int = 0

    def advance_to(self, time_ms: int) -> None:
        if time_ms < self.now_ms:
            raise ValueError("virtual clock cannot move backwards")
        if time_ms < INT64_MIN or time_ms > INT64_MAX:
            raise OverflowError("virtual clock overflow")
        self.now_ms = time_ms
