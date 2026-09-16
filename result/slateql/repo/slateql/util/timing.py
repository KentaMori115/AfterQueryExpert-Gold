"""Lightweight timing utilities used by the CLI's ``bench`` command."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

__all__ = ["Stopwatch", "format_duration", "Timings"]


class Stopwatch:
    """A restartable monotonic stopwatch.

    ``Stopwatch`` is intentionally not used inside the execution engine: query
    results must never depend on wall-clock readings.  It exists for reporting
    only.
    """

    __slots__ = ("_start", "_elapsed", "_running")

    def __init__(self, *, start: bool = False) -> None:
        self._start = 0.0
        self._elapsed = 0.0
        self._running = False
        if start:
            self.start()

    def start(self) -> "Stopwatch":
        if not self._running:
            self._start = time.perf_counter()
            self._running = True
        return self

    def stop(self) -> "Stopwatch":
        if self._running:
            self._elapsed += time.perf_counter() - self._start
            self._running = False
        return self

    def reset(self) -> "Stopwatch":
        self._elapsed = 0.0
        self._running = False
        return self

    @property
    def elapsed(self) -> float:
        """Seconds accumulated so far, including the in-flight interval."""

        if self._running:
            return self._elapsed + (time.perf_counter() - self._start)
        return self._elapsed

    def __enter__(self) -> "Stopwatch":
        return self.start()

    def __exit__(self, *exc_info: object) -> None:
        self.stop()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Stopwatch(elapsed={self.elapsed:.6f})"


def format_duration(seconds: float) -> str:
    """Render ``seconds`` using a unit that keeps three significant digits."""

    if seconds < 0:
        raise ValueError("duration must not be negative")
    if seconds < 1e-3:
        return f"{seconds * 1e6:.1f}us"
    if seconds < 1.0:
        return f"{seconds * 1e3:.2f}ms"
    if seconds < 60.0:
        return f"{seconds:.3f}s"
    minutes, rest = divmod(seconds, 60.0)
    return f"{int(minutes)}m{rest:05.2f}s"


@dataclass
class Timings:
    """Named phase timings collected while running a statement."""

    phases: dict[str, float] = field(default_factory=dict)

    def record(self, phase: str, seconds: float) -> None:
        self.phases[phase] = self.phases.get(phase, 0.0) + seconds

    def total(self) -> float:
        return sum(self.phases.values())

    def describe(self, *, order: Optional[list[str]] = None) -> str:
        names = order or sorted(self.phases)
        parts = [
            f"{name}={format_duration(self.phases[name])}"
            for name in names
            if name in self.phases
        ]
        return " ".join(parts)
