"""Routes, the modes they run in, and the agencies that run them.

A route is the name on the front of the vehicle. It does not say where the
vehicle goes, because two trips on the same route can call at different stops:
that is what a pattern is for.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from layover.errors import NetworkError

__all__ = ["Agency", "Mode", "Route"]

_MODE_NUMBERS = {
    "0": "tram",
    "1": "metro",
    "2": "rail",
    "3": "bus",
    "4": "ferry",
    "5": "cable",
    "6": "gondola",
    "7": "funicular",
}


class Mode(Enum):
    """How a route moves."""

    TRAM = "tram"
    METRO = "metro"
    RAIL = "rail"
    BUS = "bus"
    FERRY = "ferry"
    CABLE = "cable"
    GONDOLA = "gondola"
    FUNICULAR = "funicular"

    @classmethod
    def parse(cls, text) -> "Mode":
        """Read a mode from its name or the number a feed writes."""
        if isinstance(text, Mode):
            return text
        cleaned = str(text).strip().lower()
        cleaned = _MODE_NUMBERS.get(cleaned, cleaned)
        for mode in cls:
            if mode.value == cleaned:
                return mode
        raise NetworkError("no such mode: %r" % (text,))

    @property
    def on_rails(self) -> bool:
        """Whether the mode runs on a fixed guideway."""
        return self in (Mode.TRAM, Mode.METRO, Mode.RAIL, Mode.FUNICULAR)

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Agency:
    """Whoever runs a route.

    ``timezone`` is recorded as written and is not interpreted anywhere: every
    time in the engine is a service day offset, so a feed spanning two zones is
    out of scope for now.
    """

    agency_id: str
    name: str
    url: str = ""
    timezone: str = ""

    def __post_init__(self) -> None:
        identifier = str(self.agency_id).strip()
        if not identifier:
            raise NetworkError("an agency needs an identifier")
        object.__setattr__(self, "agency_id", identifier)
        name = str(self.name).strip()
        if not name:
            raise NetworkError("agency %r needs a name" % identifier)
        object.__setattr__(self, "name", name)

    def __str__(self) -> str:
        return self.name


@dataclass(frozen=True)
class Route:
    """A named service a passenger recognises, such as U2 or the 100 bus."""

    route_id: str
    short_name: str
    long_name: str = ""
    mode: Mode = Mode.BUS
    agency_id: Optional[str] = None
    colour: Optional[str] = None

    def __post_init__(self) -> None:
        identifier = str(self.route_id).strip()
        if not identifier:
            raise NetworkError("a route needs an identifier")
        object.__setattr__(self, "route_id", identifier)
        short = str(self.short_name).strip()
        if not short and not str(self.long_name).strip():
            raise NetworkError("route %r needs a name" % identifier)
        object.__setattr__(self, "short_name", short)
        object.__setattr__(self, "long_name", str(self.long_name).strip())
        object.__setattr__(self, "mode", Mode.parse(self.mode))
        if self.colour is not None:
            colour = str(self.colour).strip().lstrip("#").upper()
            if len(colour) != 6 or any(digit not in "0123456789ABCDEF" for digit in colour):
                raise NetworkError("route %r has a colour that is not six hex digits" % identifier)
            object.__setattr__(self, "colour", colour)

    @property
    def name(self) -> str:
        """The best name to show: the short one, falling back to the long one."""
        return self.short_name or self.long_name

    @property
    def full_name(self) -> str:
        """Both names together, when the route has both."""
        if self.short_name and self.long_name:
            return "%s %s" % (self.short_name, self.long_name)
        return self.name

    def __str__(self) -> str:
        return "%s %s" % (self.mode, self.name)
