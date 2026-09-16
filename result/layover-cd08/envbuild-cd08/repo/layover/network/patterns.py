"""Stop patterns: the ordered list of stops a set of trips calls at.

Every trip on a route calls at the same stops in the same order as some other
trips, and differs only in when. Grouping trips by their pattern is what makes
a search cheap: the pattern is walked once and its trips are scanned as a sorted
column of departure times.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from layover.errors import NetworkError

__all__ = ["Pattern"]


def _flags(values: Optional[Iterable], length: int, default: bool, what: str) -> tuple[bool, ...]:
    if values is None:
        return (default,) * length
    flags = tuple(bool(value) for value in values)
    if len(flags) != length:
        raise NetworkError("a pattern has %d stops but %d %s flags" % (length, len(flags), what))
    return flags


@dataclass(frozen=True)
class Pattern:
    """A route, a direction, and the stops called at in order.

    ``pickup`` and ``dropoff`` say where a passenger may board and alight. A
    stop that is set down only, such as the last one on a suburban run, has
    pickup off, and a search that boards there is wrong rather than slow.
    """

    pattern_id: str
    route_id: str
    stops: tuple[str, ...]
    pickup: tuple[bool, ...] = ()
    dropoff: tuple[bool, ...] = ()
    headsign: str = ""
    direction: int = 0

    def __post_init__(self) -> None:
        identifier = str(self.pattern_id).strip()
        if not identifier:
            raise NetworkError("a pattern needs an identifier")
        object.__setattr__(self, "pattern_id", identifier)
        if not str(self.route_id).strip():
            raise NetworkError("pattern %r needs a route" % identifier)
        stops = tuple(str(stop).strip() for stop in self.stops)
        if len(stops) < 2:
            raise NetworkError("pattern %r calls at fewer than two stops" % identifier)
        if any(not stop for stop in stops):
            raise NetworkError("pattern %r has a stop with no identifier" % identifier)
        for first, second in zip(stops, stops[1:]):
            if first == second:
                raise NetworkError("pattern %r calls at %r twice in a row" % (identifier, first))
        object.__setattr__(self, "stops", stops)
        object.__setattr__(self, "pickup", _flags(self.pickup or None, len(stops), True, "pickup"))
        object.__setattr__(self, "dropoff", _flags(self.dropoff or None, len(stops), True, "dropoff"))
        if self.direction not in (0, 1):
            raise NetworkError("pattern %r has direction %r, which is 0 or 1" % (identifier, self.direction))
        object.__setattr__(self, "headsign", str(self.headsign).strip())

    def __len__(self) -> int:
        return len(self.stops)

    @property
    def origin(self) -> str:
        """The first stop called at."""
        return self.stops[0]

    @property
    def destination(self) -> str:
        """The last stop called at."""
        return self.stops[-1]

    @property
    def is_loop(self) -> bool:
        """Whether the pattern comes back to where it started."""
        return self.stops[0] == self.stops[-1]

    def serves(self, stop_id: str) -> bool:
        """Whether the pattern calls at a stop at all."""
        return stop_id in self.stops

    def index_of(self, stop_id: str) -> int:
        """The first position a stop is called at, raising if it never is."""
        try:
            return self.stops.index(stop_id)
        except ValueError:
            raise NetworkError(
                "pattern %r does not call at %r" % (self.pattern_id, stop_id)
            ) from None

    def indexes_of(self, stop_id: str) -> tuple[int, ...]:
        """Every position a stop is called at, which a loop can repeat."""
        return tuple(index for index, stop in enumerate(self.stops) if stop == stop_id)

    def can_board(self, index: int) -> bool:
        """Whether a passenger may get on at this position."""
        return self.pickup[index]

    def can_alight(self, index: int) -> bool:
        """Whether a passenger may get off at this position."""
        return self.dropoff[index]

    def boardable_stops(self) -> tuple[str, ...]:
        """Stops a passenger may get on at, in call order, without repeats."""
        seen = []
        for index, stop in enumerate(self.stops):
            if self.pickup[index] and stop not in seen:
                seen.append(stop)
        return tuple(seen)

    def reachable_from(self, index: int) -> tuple[tuple[int, str], ...]:
        """Positions after ``index`` where a passenger may get off."""
        return tuple(
            (position, self.stops[position])
            for position in range(index + 1, len(self.stops))
            if self.dropoff[position]
        )

    def segment(self, start: int, end: int) -> tuple[str, ...]:
        """The stops called at from one position to another, both included."""
        if not 0 <= start <= end < len(self.stops):
            raise NetworkError(
                "pattern %r has no segment %d to %d" % (self.pattern_id, start, end)
            )
        return self.stops[start : end + 1]

    def same_stops_as(self, other: "Pattern") -> bool:
        """Whether two patterns call at the same stops in the same order."""
        return self.stops == other.stops

    def describe(self) -> str:
        """A one line summary: origin to destination with a stop count."""
        return "%s to %s (%d stops)" % (self.origin, self.destination, len(self.stops))

    def __str__(self) -> str:
        return "%s: %s" % (self.pattern_id, self.describe())

    @classmethod
    def straight(
        cls,
        pattern_id: str,
        route_id: str,
        stops: Sequence[str],
        headsign: str = "",
        direction: int = 0,
    ) -> "Pattern":
        """Build a pattern where boarding and alighting are allowed throughout.

        The first stop cannot be alighted at and the last cannot be boarded at,
        which is true of every ordinary run and saves a search from considering
        a leg of no length.
        """
        pickup = [True] * len(stops)
        dropoff = [True] * len(stops)
        if stops:
            dropoff[0] = False
            pickup[-1] = False
        return cls(pattern_id, route_id, tuple(stops), tuple(pickup), tuple(dropoff), headsign, direction)
