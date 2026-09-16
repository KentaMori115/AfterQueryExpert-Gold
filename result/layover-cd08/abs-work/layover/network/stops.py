"""Stops, stations and the places between them a passenger stands.

A stop is where a vehicle calls. A station groups stops that share a name and a
concourse, and is never called at itself: a trip stops at platform 3, not at the
station. Keeping the two apart is what lets a transfer inside a station cost
ninety seconds while the same walk between two street stops costs four minutes.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from layover.errors import NetworkError
from layover.geo import Point

__all__ = ["Stop", "StopKind"]


class StopKind(Enum):
    """What a place in the stop table is."""

    STOP = "stop"
    STATION = "station"
    ENTRANCE = "entrance"

    @classmethod
    def parse(cls, text) -> "StopKind":
        """Read a kind from its name or its feed number, 0 being a plain stop."""
        if isinstance(text, StopKind):
            return text
        cleaned = str(text).strip().lower()
        if cleaned in ("", "0"):
            return cls.STOP
        if cleaned == "1":
            return cls.STATION
        if cleaned == "2":
            return cls.ENTRANCE
        for kind in cls:
            if kind.value == cleaned:
                return kind
        raise NetworkError("no such stop kind: %r" % (text,))

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Stop:
    """One place in the network, with a name and usually a position."""

    stop_id: str
    name: str
    point: Optional[Point] = None
    parent: Optional[str] = None
    kind: StopKind = StopKind.STOP
    zone: Optional[str] = None
    code: Optional[str] = None
    platform: Optional[str] = None

    def __post_init__(self) -> None:
        identifier = str(self.stop_id).strip()
        if not identifier:
            raise NetworkError("a stop needs an identifier")
        object.__setattr__(self, "stop_id", identifier)
        name = str(self.name).strip()
        if not name:
            raise NetworkError("stop %r needs a name" % identifier)
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "kind", StopKind.parse(self.kind))
        if self.kind is StopKind.STATION and self.parent is not None:
            raise NetworkError("station %r cannot sit inside another stop" % identifier)
        if self.kind is StopKind.ENTRANCE and self.parent is None:
            raise NetworkError("entrance %r needs a parent station" % identifier)
        if self.parent is not None and str(self.parent).strip() == identifier:
            raise NetworkError("stop %r is its own parent" % identifier)

    @property
    def is_station(self) -> bool:
        """Whether this is a station rather than somewhere a vehicle calls."""
        return self.kind is StopKind.STATION

    @property
    def boardable(self) -> bool:
        """Whether a trip may call here at all."""
        return self.kind is StopKind.STOP

    @property
    def label(self) -> str:
        """The name a board shows, with the platform if there is one."""
        if self.platform:
            return "%s (platform %s)" % (self.name, self.platform)
        return self.name

    def distance_to(self, other: "Stop") -> int:
        """Distance in metres to another stop, which both must have a position."""
        if self.point is None or other.point is None:
            raise NetworkError(
                "cannot measure between %r and %r without positions"
                % (self.stop_id, other.stop_id)
            )
        from layover.geo import distance_metres

        return distance_metres(self.point, other.point)

    def with_parent(self, parent: Optional[str]) -> "Stop":
        """Return the same stop attached to another station."""
        return Stop(
            self.stop_id,
            self.name,
            self.point,
            parent,
            self.kind,
            self.zone,
            self.code,
            self.platform,
        )

    def with_zone(self, zone: Optional[str]) -> "Stop":
        """Return the same stop in another fare zone."""
        return Stop(
            self.stop_id,
            self.name,
            self.point,
            self.parent,
            self.kind,
            zone,
            self.code,
            self.platform,
        )

    def __str__(self) -> str:
        return "%s (%s)" % (self.name, self.stop_id)
