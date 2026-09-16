"""Counters and timers for query execution.

Every operator records how many batches and rows it produced and how long it
spent doing so. The collector is deliberately simple: a flat namespace of
counters and a flat namespace of timers, both mergeable, so a partial run's
metrics can be folded into a parent's.

Timings are wall clock and therefore vary between runs. Nothing in the engine
branches on a timing value; they exist for reporting only.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field as dataclass_field
from typing import Any, Dict, Iterator, List, Mapping, Optional

__all__ = ["Counter", "Timer", "MetricsCollector", "MetricsSnapshot"]


@dataclass
class Counter:
    """A monotonically increasing count."""

    name: str
    value: int = 0

    def increment(self, amount: int = 1) -> "Counter":
        """Add ``amount`` to the counter.

        Raises:
            ValueError: If ``amount`` is negative.
        """
        if amount < 0:
            raise ValueError("counters may only increase")
        self.value += amount
        return self

    def merge(self, other: "Counter") -> "Counter":
        """Add another counter's value into this one."""
        self.value += other.value
        return self

    def reset(self) -> "Counter":
        """Set the counter back to zero."""
        self.value = 0
        return self


@dataclass
class Timer:
    """Accumulated elapsed time and an invocation count."""

    name: str
    total_seconds: float = 0.0
    count: int = 0

    def record(self, seconds: float) -> "Timer":
        """Add one observation."""
        self.total_seconds += seconds
        self.count += 1
        return self

    def merge(self, other: "Timer") -> "Timer":
        """Fold another timer's observations into this one."""
        self.total_seconds += other.total_seconds
        self.count += other.count
        return self

    @property
    def average_seconds(self) -> float:
        """Mean duration, or zero when nothing was recorded."""
        return 0.0 if self.count == 0 else self.total_seconds / self.count

    @property
    def milliseconds(self) -> float:
        """Total elapsed time in milliseconds."""
        return self.total_seconds * 1000.0

    def reset(self) -> "Timer":
        """Discard every observation."""
        self.total_seconds = 0.0
        self.count = 0
        return self


@dataclass(frozen=True)
class MetricsSnapshot:
    """An immutable copy of a collector's state."""

    counters: Dict[str, int] = dataclass_field(default_factory=dict)
    timers: Dict[str, float] = dataclass_field(default_factory=dict)

    def counter(self, name: str, default: int = 0) -> int:
        """Return one counter value."""
        return self.counters.get(name, default)

    def timer(self, name: str, default: float = 0.0) -> float:
        """Return one timer's total in seconds."""
        return self.timers.get(name, default)

    def to_dict(self) -> Dict[str, Any]:
        """Return a flat dictionary suitable for a query result."""
        payload: Dict[str, Any] = dict(self.counters)
        for name, seconds in self.timers.items():
            payload[f"{name}_ms"] = round(seconds * 1000.0, 3)
        return payload

    def describe(self) -> str:
        """Render the snapshot as one line per metric."""
        lines = [f"{name}: {value}" for name, value in sorted(self.counters.items())]
        lines.extend(
            f"{name}: {seconds * 1000:.2f}ms"
            for name, seconds in sorted(self.timers.items())
        )
        return "\n".join(lines) or "(no metrics recorded)"


class MetricsCollector:
    """Collects counters and timers for one query execution."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._counters: Dict[str, Counter] = {}
        self._timers: Dict[str, Timer] = {}

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------
    def increment(self, name: str, amount: int = 1) -> None:
        """Add to a counter, creating it on first use."""
        if not self.enabled:
            return
        counter = self._counters.get(name)
        if counter is None:
            counter = self._counters[name] = Counter(name)
        counter.increment(amount)

    def record(self, name: str, seconds: float) -> None:
        """Add one timing observation."""
        if not self.enabled:
            return
        timer = self._timers.get(name)
        if timer is None:
            timer = self._timers[name] = Timer(name)
        timer.record(seconds)

    @contextmanager
    def timer(self, name: str) -> Iterator[None]:
        """Time the enclosed block, recording it even if it raises."""
        if not self.enabled:
            yield
            return
        started = time.perf_counter()
        try:
            yield
        finally:
            self.record(name, time.perf_counter() - started)

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------
    def counter(self, name: str) -> int:
        """Return one counter's value, zero when it does not exist."""
        counter = self._counters.get(name)
        return counter.value if counter else 0

    def elapsed(self, name: str) -> float:
        """Return one timer's total seconds, zero when it does not exist."""
        timer = self._timers.get(name)
        return timer.total_seconds if timer else 0.0

    def counter_names(self) -> List[str]:
        """Every recorded counter name, sorted."""
        return sorted(self._counters)

    def timer_names(self) -> List[str]:
        """Every recorded timer name, sorted."""
        return sorted(self._timers)

    def snapshot(self) -> MetricsSnapshot:
        """Return an immutable copy of the current state."""
        return MetricsSnapshot(
            counters={name: item.value for name, item in self._counters.items()},
            timers={name: item.total_seconds for name, item in self._timers.items()},
        )

    def merge(self, other: "MetricsCollector") -> "MetricsCollector":
        """Fold another collector's metrics into this one."""
        for name, counter in other._counters.items():
            self._counters.setdefault(name, Counter(name)).merge(counter)
        for name, timer in other._timers.items():
            self._timers.setdefault(name, Timer(name)).merge(timer)
        return self

    def reset(self) -> None:
        """Discard every metric."""
        self._counters.clear()
        self._timers.clear()

    def to_dict(self) -> Dict[str, Any]:
        """Return the snapshot as a flat dictionary."""
        return self.snapshot().to_dict()

    def __repr__(self) -> str:
        return (
            f"MetricsCollector({len(self._counters)} counters, "
            f"{len(self._timers)} timers)"
        )
