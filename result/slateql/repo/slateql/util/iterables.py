"""Iterator helpers used by operators and by the planner."""

from __future__ import annotations

from typing import Callable, Iterable, Iterator, Optional, Sequence, TypeVar

T = TypeVar("T")
K = TypeVar("K")

__all__ = ["batched", "dedupe", "first", "flatten", "partition", "chunk_indices"]


def batched(items: Iterable[T], size: int) -> Iterator[list[T]]:
    """Yield lists of at most ``size`` items drawn from ``items``.

    The final batch may be shorter.  Empty input yields nothing at all, which
    matters for operators that must not emit a spurious empty batch.
    """

    if size <= 0:
        raise ValueError("batch size must be positive")
    buffer: list[T] = []
    for item in items:
        buffer.append(item)
        if len(buffer) >= size:
            yield buffer
            buffer = []
    if buffer:
        yield buffer


def dedupe(items: Iterable[T], key: Optional[Callable[[T], object]] = None) -> list[T]:
    """Return ``items`` with duplicates removed, preserving first occurrence."""

    seen: set[object] = set()
    out: list[T] = []
    for item in items:
        marker = key(item) if key is not None else item
        if marker in seen:
            continue
        seen.add(marker)
        out.append(item)
    return out


def first(items: Iterable[T], predicate: Optional[Callable[[T], bool]] = None) -> Optional[T]:
    """Return the first item matching ``predicate`` or ``None``."""

    for item in items:
        if predicate is None or predicate(item):
            return item
    return None


def flatten(nested: Iterable[Iterable[T]]) -> list[T]:
    """Concatenate one level of nesting into a flat list."""

    out: list[T] = []
    for group in nested:
        out.extend(group)
    return out


def partition(
    items: Iterable[T], predicate: Callable[[T], bool]
) -> tuple[list[T], list[T]]:
    """Split ``items`` into ``(matching, non_matching)`` preserving order."""

    yes: list[T] = []
    no: list[T] = []
    for item in items:
        (yes if predicate(item) else no).append(item)
    return yes, no


def chunk_indices(total: int, size: int) -> Iterator[tuple[int, int]]:
    """Yield ``(start, stop)`` half-open ranges covering ``total`` items."""

    if size <= 0:
        raise ValueError("chunk size must be positive")
    start = 0
    while start < total:
        stop = min(start + size, total)
        yield start, stop
        start = stop


def sequence_equal(left: Sequence[object], right: Sequence[object]) -> bool:
    """Compare two sequences element-wise without relying on ``__eq__`` of the
    container type, which differs between lists and tuples."""

    if len(left) != len(right):
        return False
    return all(a == b for a, b in zip(left, right))
