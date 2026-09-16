"""What a passenger will put up with: the settings a search runs under.

Defaults are deliberately generous, because a search that finds nothing is
harder to debug than one that finds too much. Tighten them per query rather
than editing the defaults, so two callers never disagree about what a plain
search means.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import FrozenSet, Iterable, Optional

from layover.errors import PlanError
from layover.times import SECONDS_PER_HOUR, format_duration

__all__ = ["SearchOptions"]


@dataclass(frozen=True)
class SearchOptions:
    """The limits a journey search works inside."""

    max_transfers: int = 4
    min_transfer_seconds: int = 0
    max_walk_seconds: Optional[int] = 900
    max_journeys: int = 5
    search_window: int = 3 * SECONDS_PER_HOUR
    allowed_modes: Optional[FrozenSet[str]] = None
    banned_routes: FrozenSet[str] = frozenset()

    def __post_init__(self) -> None:
        if self.max_transfers < 0:
            raise PlanError("a search cannot allow %d changes" % self.max_transfers)
        if self.min_transfer_seconds < 0:
            raise PlanError("a change cannot take negative time")
        if self.max_walk_seconds is not None and self.max_walk_seconds < 0:
            raise PlanError("a walk cannot be limited to negative time")
        if self.max_journeys < 1:
            raise PlanError("a search has to return at least one journey")
        if self.search_window <= 0:
            raise PlanError("a search window has to be some length of time")
        if self.allowed_modes is not None:
            modes = frozenset(str(mode).strip().lower() for mode in self.allowed_modes)
            if not modes:
                raise PlanError("a search that allows no mode can never find anything")
            object.__setattr__(self, "allowed_modes", modes)
        object.__setattr__(
            self, "banned_routes", frozenset(str(route) for route in self.banned_routes)
        )

    @property
    def max_rides(self) -> int:
        """How many vehicles a journey may use."""
        return self.max_transfers + 1

    def allows_mode(self, mode) -> bool:
        """Whether a route in this mode may be used."""
        if self.allowed_modes is None:
            return True
        return str(mode).strip().lower() in self.allowed_modes

    def allows_route(self, route_id: str) -> bool:
        """Whether a route may be used."""
        return route_id not in self.banned_routes

    def allows_walk(self, seconds: int) -> bool:
        """Whether a transfer of this length may be walked."""
        return self.max_walk_seconds is None or seconds <= self.max_walk_seconds

    def with_transfers(self, count: int) -> "SearchOptions":
        """Return the same settings allowing a different number of changes."""
        return replace(self, max_transfers=count)

    def with_modes(self, modes: Optional[Iterable[str]]) -> "SearchOptions":
        """Return the same settings restricted to a set of modes."""
        return replace(self, allowed_modes=None if modes is None else frozenset(modes))

    def without_routes(self, routes: Iterable[str]) -> "SearchOptions":
        """Return the same settings with some routes taken out of service."""
        return replace(self, banned_routes=frozenset(routes))

    def with_window(self, seconds: int) -> "SearchOptions":
        """Return the same settings looking a different distance ahead."""
        return replace(self, search_window=seconds)

    def describe(self) -> str:
        """A one line summary of the limits, for a report header."""
        parts = [
            "up to %d changes" % self.max_transfers,
            "window %s" % format_duration(self.search_window),
        ]
        if self.min_transfer_seconds:
            parts.append("buffer %s" % format_duration(self.min_transfer_seconds))
        if self.max_walk_seconds is not None:
            parts.append("walk up to %s" % format_duration(self.max_walk_seconds))
        if self.allowed_modes is not None:
            parts.append("modes %s" % ", ".join(sorted(self.allowed_modes)))
        if self.banned_routes:
            parts.append("not %s" % ", ".join(sorted(self.banned_routes)))
        return "; ".join(parts)

    def __str__(self) -> str:
        return self.describe()
