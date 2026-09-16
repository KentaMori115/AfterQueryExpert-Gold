"""Lightweight nested spans for query execution.

A tracer records a tree of spans, each with a name, a duration and free-form
attributes. It is not an OpenTelemetry client: spans stay in process and exist
so ``EXPLAIN ANALYZE``-style output can attribute time to plan nodes.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field as dataclass_field
from typing import Any, Dict, Iterator, List, Optional

__all__ = ["Span", "Tracer"]


@dataclass
class Span:
    """One timed, named region with optional children."""

    name: str
    started_at: float
    ended_at: Optional[float] = None
    attributes: Dict[str, Any] = dataclass_field(default_factory=dict)
    children: List["Span"] = dataclass_field(default_factory=list)

    @property
    def duration_seconds(self) -> float:
        """Elapsed time, or zero while the span is still open."""
        if self.ended_at is None:
            return 0.0
        return self.ended_at - self.started_at

    @property
    def is_open(self) -> bool:
        """True until the span has been closed."""
        return self.ended_at is None

    def set(self, **attributes: Any) -> "Span":
        """Attach attributes to the span."""
        self.attributes.update(attributes)
        return self

    def add_child(self, child: "Span") -> "Span":
        """Nest another span under this one."""
        self.children.append(child)
        return child

    def close(self, at: Optional[float] = None) -> "Span":
        """Mark the span finished."""
        if self.ended_at is None:
            self.ended_at = at if at is not None else time.perf_counter()
        return self

    def walk(self) -> Iterator["Span"]:
        """Yield this span and every descendant, parents first."""
        yield self
        for child in self.children:
            yield from child.walk()

    def describe(self) -> str:
        """Render one line for this span."""
        rendered = " ".join(f"{key}={value}" for key, value in sorted(self.attributes.items()))
        suffix = f" {rendered}" if rendered else ""
        return f"{self.name} ({self.duration_seconds * 1000:.2f}ms){suffix}"


class Tracer:
    """Builds a tree of spans."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._roots: List[Span] = []
        self._stack: List[Span] = []

    @contextmanager
    def span(self, name: str, **attributes: Any) -> Iterator[Span]:
        """Open a span for the enclosed block.

        The span is closed even if the block raises, so a failed query still
        produces a usable trace.
        """
        if not self.enabled:
            yield Span(name, 0.0, 0.0)
            return
        span = Span(name, time.perf_counter(), attributes=dict(attributes))
        if self._stack:
            self._stack[-1].add_child(span)
        else:
            self._roots.append(span)
        self._stack.append(span)
        try:
            yield span
        finally:
            span.close()
            self._stack.pop()

    @property
    def roots(self) -> List[Span]:
        """The top-level spans, in the order they were opened."""
        return list(self._roots)

    @property
    def current(self) -> Optional[Span]:
        """The innermost open span, when there is one."""
        return self._stack[-1] if self._stack else None

    def spans(self) -> List[Span]:
        """Every span in the trace, depth first."""
        found: List[Span] = []
        for root in self._roots:
            found.extend(root.walk())
        return found

    def total_seconds(self) -> float:
        """Sum of the root spans' durations."""
        return sum(span.duration_seconds for span in self._roots)

    def clear(self) -> None:
        """Discard the whole trace."""
        self._roots.clear()
        self._stack.clear()

    def render(self, indent: str = "  ") -> str:
        """Render the trace as an indented tree."""
        lines: List[str] = []

        def emit(span: Span, depth: int) -> None:
            lines.append(f"{indent * depth}{span.describe()}")
            for child in span.children:
                emit(child, depth + 1)

        for root in self._roots:
            emit(root, 0)
        return "\n".join(lines) or "(no spans recorded)"

    def __len__(self) -> int:
        return len(self.spans())

    def __repr__(self) -> str:
        return f"Tracer({len(self._roots)} root spans)"
