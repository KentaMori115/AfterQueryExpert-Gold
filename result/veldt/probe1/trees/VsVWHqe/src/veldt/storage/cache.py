"""Caching of materialised scans.

Reading the same CSV twice in one session is common — a self-join, or a query
run once to inspect and again to aggregate. The cache stores whole tables keyed
by source name and projection, evicting the least recently used entry when the
budget is exceeded.

The budget is counted in rows rather than bytes: rows are what the engine can
measure cheaply and exactly.
"""

from __future__ import annotations

from typing import Any, Dict, Generic, Iterator, List, Optional, Sequence, Tuple, TypeVar

from ..core.table import Table
from ..errors import ConfigurationError

__all__ = ["LruCache", "MaterializationCache", "CacheStatistics"]

K = TypeVar("K")
V = TypeVar("V")


class LruCache(Generic[K, V]):
    """A least-recently-used cache with a fixed entry count."""

    def __init__(self, capacity: int = 16) -> None:
        if capacity < 1:
            raise ConfigurationError("cache capacity must be at least 1")
        self.capacity = capacity
        self._entries: Dict[K, V] = {}
        self._order: List[K] = []
        self._hits = 0
        self._misses = 0

    def get(self, key: K) -> Optional[V]:
        """Return a cached value and mark it as most recently used."""
        if key not in self._entries:
            self._misses += 1
            return None
        self._hits += 1
        self._touch(key)
        return self._entries[key]

    def put(self, key: K, value: V) -> None:
        """Store a value, evicting the oldest entry when full."""
        if key in self._entries:
            self._entries[key] = value
            self._touch(key)
            return
        if len(self._entries) >= self.capacity:
            oldest = self._order.pop(0)
            self._entries.pop(oldest, None)
        self._entries[key] = value
        self._order.append(key)

    def pop(self, key: K) -> Optional[V]:
        """Remove and return an entry, or ``None`` when absent."""
        if key not in self._entries:
            return None
        self._order.remove(key)
        return self._entries.pop(key)

    def clear(self) -> None:
        """Drop every entry and reset the hit counters."""
        self._entries.clear()
        self._order.clear()
        self._hits = 0
        self._misses = 0

    def keys(self) -> List[K]:
        """Keys ordered from least to most recently used."""
        return list(self._order)

    @property
    def hits(self) -> int:
        """How many lookups found an entry."""
        return self._hits

    @property
    def misses(self) -> int:
        """How many lookups found nothing."""
        return self._misses

    def _touch(self, key: K) -> None:
        self._order.remove(key)
        self._order.append(key)

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, key: object) -> bool:
        return key in self._entries

    def __iter__(self) -> Iterator[K]:
        return iter(list(self._order))


class CacheStatistics:
    """A snapshot of a cache's counters."""

    __slots__ = ("entries", "rows", "hits", "misses")

    def __init__(self, entries: int, rows: int, hits: int, misses: int) -> None:
        self.entries = entries
        self.rows = rows
        self.hits = hits
        self.misses = misses

    @property
    def hit_rate(self) -> float:
        """Fraction of lookups that were served from the cache."""
        total = self.hits + self.misses
        return 0.0 if total == 0 else self.hits / total

    def describe(self) -> str:
        """Render the snapshot as one line."""
        return (
            f"{self.entries} entries, {self.rows} rows, "
            f"{self.hits} hits, {self.misses} misses "
            f"({self.hit_rate:.0%} hit rate)"
        )

    def __repr__(self) -> str:
        return f"CacheStatistics({self.describe()})"


class MaterializationCache:
    """Caches whole tables keyed by source name and projection."""

    def __init__(self, max_rows: int = 1_000_000, max_entries: int = 16) -> None:
        if max_rows < 0:
            raise ConfigurationError("max_rows must not be negative")
        self.max_rows = max_rows
        self._cache: LruCache[Tuple[str, Optional[Tuple[str, ...]]], Table] = LruCache(
            max_entries
        )
        self._rows = 0

    @staticmethod
    def key(name: str, projection: Optional[Sequence[str]]) -> Tuple[str, Optional[Tuple[str, ...]]]:
        """Build the cache key for a source name and projection."""
        columns = tuple(sorted(item.lower() for item in projection)) if projection else None
        return (name.lower(), columns)

    def get(self, name: str, projection: Optional[Sequence[str]] = None) -> Optional[Table]:
        """Return a cached table, or ``None`` on a miss."""
        return self._cache.get(self.key(name, projection))

    def put(
        self, name: str, table: Table, projection: Optional[Sequence[str]] = None
    ) -> bool:
        """Cache a table unless it would blow the row budget.

        Returns:
            True when the table was stored.
        """
        if table.num_rows > self.max_rows:
            return False
        key = self.key(name, projection)
        existing = self._cache.pop(key)
        if existing is not None:
            self._rows -= existing.num_rows
        while self._rows + table.num_rows > self.max_rows and len(self._cache):
            oldest = self._cache.keys()[0]
            evicted = self._cache.pop(oldest)
            if evicted is not None:
                self._rows -= evicted.num_rows
        self._cache.put(key, table)
        self._rows += table.num_rows
        return True

    def invalidate(self, name: str) -> int:
        """Drop every entry for a table name.

        Returns:
            How many entries were removed.
        """
        lowered = name.lower()
        removed = 0
        for key in list(self._cache.keys()):
            if key[0] == lowered:
                table = self._cache.pop(key)
                if table is not None:
                    self._rows -= table.num_rows
                    removed += 1
        return removed

    def clear(self) -> None:
        """Drop every entry."""
        self._cache.clear()
        self._rows = 0

    def statistics(self) -> CacheStatistics:
        """Return a snapshot of the cache counters."""
        return CacheStatistics(
            entries=len(self._cache),
            rows=self._rows,
            hits=self._cache.hits,
            misses=self._cache.misses,
        )

    def __len__(self) -> int:
        return len(self._cache)

    def __repr__(self) -> str:
        return f"MaterializationCache({self.statistics().describe()})"
