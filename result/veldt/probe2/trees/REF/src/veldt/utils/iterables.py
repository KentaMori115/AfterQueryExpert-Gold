"""Iterator helpers used across the engine.

Nothing here knows about schemas, plans, or batches; these are the generic
building blocks that the rest of the package leans on.
"""

from __future__ import annotations

from typing import Callable, Dict, Hashable, Iterable, Iterator, List, Optional, Sequence, Tuple, TypeVar

T = TypeVar("T")
K = TypeVar("K")

__all__ = [
    "chunked",
    "flatten",
    "unique",
    "unique_by",
    "first",
    "partition",
    "group_by",
    "pairwise",
    "index_where",
    "take",
    "Peekable",
]


def chunked(items: Iterable[T], size: int) -> Iterator[List[T]]:
    """Yield lists of at most ``size`` items from ``items``.

    The final chunk may be shorter. An empty input yields nothing at all
    rather than a single empty chunk, which keeps operator loops simple.

    Raises:
        ValueError: If ``size`` is not positive.
    """
    if size <= 0:
        raise ValueError("chunk size must be positive")
    buffer: List[T] = []
    for item in items:
        buffer.append(item)
        if len(buffer) == size:
            yield buffer
            buffer = []
    if buffer:
        yield buffer


def flatten(nested: Iterable[Iterable[T]]) -> Iterator[T]:
    """Yield every element of every sub-iterable, one level deep."""
    for group in nested:
        for item in group:
            yield item


def unique(items: Iterable[T]) -> List[T]:
    """Return items with duplicates removed, preserving first-seen order.

    Falls back to a linear scan for unhashable elements so callers can pass
    lists of lists without special casing.
    """
    seen: set = set()
    unhashable: List[T] = []
    result: List[T] = []
    for item in items:
        try:
            if item in seen:
                continue
            seen.add(item)
        except TypeError:
            if any(item == other for other in unhashable):
                continue
            unhashable.append(item)
        result.append(item)
    return result


def unique_by(items: Iterable[T], key: Callable[[T], Hashable]) -> List[T]:
    """Return items whose ``key`` has not been seen before, in order."""
    seen: set = set()
    result: List[T] = []
    for item in items:
        marker = key(item)
        if marker in seen:
            continue
        seen.add(marker)
        result.append(item)
    return result


def first(items: Iterable[T], predicate: Optional[Callable[[T], bool]] = None) -> Optional[T]:
    """Return the first matching item, or ``None`` when there is none."""
    for item in items:
        if predicate is None or predicate(item):
            return item
    return None


def partition(items: Iterable[T], predicate: Callable[[T], bool]) -> Tuple[List[T], List[T]]:
    """Split ``items`` into ``(matching, non_matching)`` lists."""
    matching: List[T] = []
    rest: List[T] = []
    for item in items:
        (matching if predicate(item) else rest).append(item)
    return matching, rest


def group_by(items: Iterable[T], key: Callable[[T], K]) -> Dict[K, List[T]]:
    """Group items into a dict keyed by ``key``, preserving insertion order."""
    groups: Dict[K, List[T]] = {}
    for item in items:
        groups.setdefault(key(item), []).append(item)
    return groups


def pairwise(items: Sequence[T]) -> Iterator[Tuple[T, T]]:
    """Yield consecutive overlapping pairs from a sequence."""
    for index in range(len(items) - 1):
        yield items[index], items[index + 1]


def index_where(items: Sequence[T], predicate: Callable[[T], bool]) -> int:
    """Return the index of the first match, or ``-1`` when absent."""
    for index, item in enumerate(items):
        if predicate(item):
            return index
    return -1


def take(items: Iterable[T], count: int) -> List[T]:
    """Return at most ``count`` items from the front of ``items``."""
    if count <= 0:
        return []
    result: List[T] = []
    for item in items:
        result.append(item)
        if len(result) >= count:
            break
    return result


class Peekable:
    """An iterator wrapper that supports one token of lookahead.

    The parser needs to inspect the next token without consuming it. Rather
    than materialising every token stream into a list, callers can wrap any
    iterator in this adapter.
    """

    __slots__ = ("_iterator", "_buffer", "_exhausted")

    def __init__(self, iterable: Iterable[T]) -> None:
        self._iterator = iter(iterable)
        self._buffer: List[T] = []
        self._exhausted = False

    def __iter__(self) -> "Peekable":
        return self

    def __next__(self) -> T:
        if self._buffer:
            return self._buffer.pop(0)
        return next(self._iterator)

    def peek(self, default: Optional[T] = None) -> Optional[T]:
        """Return the next item without consuming it."""
        if not self._buffer:
            try:
                self._buffer.append(next(self._iterator))
            except StopIteration:
                self._exhausted = True
                return default
        return self._buffer[0]

    def push_back(self, item: T) -> None:
        """Return an item to the front of the stream."""
        self._buffer.insert(0, item)

    @property
    def exhausted(self) -> bool:
        """True once ``peek`` has run off the end of the underlying stream."""
        return self._exhausted and not self._buffer
