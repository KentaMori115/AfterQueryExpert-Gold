"""Transfers: how long it takes to get from one stop to another on foot.

The engine only knows the transfers a feed declares. Working out that two stops
forty metres apart are walkable is a job for something that has the whole street
layout, and guessing it from a straight line distance would invent connections
that a passenger cannot make.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Optional

from layover.errors import NetworkError
from layover.times import format_duration

__all__ = ["Transfer", "TransferKind", "closure"]


class TransferKind(Enum):
    """Why a transfer exists and how much room it needs."""

    IN_STATION = "in-station"
    WALK = "walk"
    STAY_SEATED = "stay-seated"

    @classmethod
    def parse(cls, text) -> "TransferKind":
        """Read a kind from its name."""
        if isinstance(text, TransferKind):
            return text
        cleaned = str(text).strip().lower().replace("_", "-")
        for kind in cls:
            if kind.value == cleaned:
                return kind
        raise NetworkError("no such transfer kind: %r" % (text,))

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Transfer:
    """A walk between two stops, with the time it takes at worst."""

    from_stop: str
    to_stop: str
    seconds: int
    kind: TransferKind = TransferKind.WALK
    distance_metres: Optional[int] = None

    def __post_init__(self) -> None:
        origin = str(self.from_stop).strip()
        target = str(self.to_stop).strip()
        if not origin or not target:
            raise NetworkError("a transfer needs two stops")
        if origin == target:
            raise NetworkError("stop %r transfers to itself" % origin)
        object.__setattr__(self, "from_stop", origin)
        object.__setattr__(self, "to_stop", target)
        seconds = int(self.seconds)
        if seconds < 0:
            raise NetworkError("transfer from %r to %r takes negative time" % (origin, target))
        object.__setattr__(self, "seconds", seconds)
        object.__setattr__(self, "kind", TransferKind.parse(self.kind))
        if self.distance_metres is not None:
            distance = int(self.distance_metres)
            if distance < 0:
                raise NetworkError(
                    "transfer from %r to %r covers a negative distance" % (origin, target)
                )
            object.__setattr__(self, "distance_metres", distance)

    @property
    def pair(self) -> tuple[str, str]:
        """The two stops, in the direction the transfer runs."""
        return (self.from_stop, self.to_stop)

    def reversed(self) -> "Transfer":
        """Return the same walk in the other direction."""
        return Transfer(self.to_stop, self.from_stop, self.seconds, self.kind, self.distance_metres)

    def with_seconds(self, seconds: int) -> "Transfer":
        """Return the same walk taking a different length of time."""
        return Transfer(self.from_stop, self.to_stop, seconds, self.kind, self.distance_metres)

    def __str__(self) -> str:
        return "%s to %s in %s" % (self.from_stop, self.to_stop, format_duration(self.seconds))


def closure(transfers: Iterable[Transfer], limit: int = 2) -> tuple[Transfer, ...]:
    """Chain transfers up to ``limit`` hops and return the quickest of each pair.

    Feeds usually declare transfers between neighbours only, so a passenger who
    has to cross two courtyards is stranded. Chaining them keeps the shortest
    walk found and never chains through more hops than asked for.
    """
    if limit < 1:
        raise NetworkError("a transfer closure needs at least one hop, got %d" % limit)
    best: dict = {}
    for transfer in transfers:
        current = best.get(transfer.pair)
        if current is None or transfer.seconds < current.seconds:
            best[transfer.pair] = transfer
    for _ in range(limit - 1):
        grown = dict(best)
        for first in best.values():
            for second in best.values():
                if first.to_stop != second.from_stop:
                    continue
                if first.from_stop == second.to_stop:
                    continue
                pair = (first.from_stop, second.to_stop)
                seconds = first.seconds + second.seconds
                current = grown.get(pair)
                if current is None or seconds < current.seconds:
                    grown[pair] = Transfer(pair[0], pair[1], seconds, TransferKind.WALK)
        if grown == best:
            break
        best = grown
    return tuple(sorted(best.values(), key=lambda transfer: (transfer.from_stop, transfer.to_stop)))
