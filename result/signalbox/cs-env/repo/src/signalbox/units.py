"""Distances and speeds in the units a signal engineer actually writes down.

British schemes are still dimensioned in miles and chains, gradients are quoted
as ``1 in N``, and speeds are in miles per hour, while braking calculations want
metres and metres per second. Everything here stores metres and seconds
internally and converts at the edges.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import UnitError

YARDS_PER_CHAIN = 22.0
CHAINS_PER_MILE = 80.0
METRES_PER_YARD = 0.9144
METRES_PER_CHAIN = YARDS_PER_CHAIN * METRES_PER_YARD
METRES_PER_MILE = CHAINS_PER_MILE * METRES_PER_CHAIN
MPH_TO_MPS = 0.44704

_MILEAGE = re.compile(
    r"^\s*(?:(?P<miles>\d+)\s*m)?\s*(?:(?P<chains>\d+(?:\.\d+)?)\s*ch)?\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True, order=True)
class Distance:
    """A length along the track, held in metres."""

    metres: float

    @classmethod
    def from_miles_chains(cls, miles: int, chains: float) -> Distance:
        if chains < 0 or chains >= CHAINS_PER_MILE:
            raise UnitError(f"chains must be in [0, 80), got {chains}")
        return cls(miles * METRES_PER_MILE + chains * METRES_PER_CHAIN)

    @classmethod
    def from_yards(cls, yards: float) -> Distance:
        return cls(yards * METRES_PER_YARD)

    @classmethod
    def parse(cls, text: str) -> Distance:
        """Read ``"12m 34ch"``, ``"34ch"`` or ``"12m"``."""
        match = _MILEAGE.match(text)
        if match is None or (not match.group("miles") and not match.group("chains")):
            raise UnitError(f"cannot read {text!r} as a mileage")
        miles = int(match.group("miles") or 0)
        chains = float(match.group("chains") or 0.0)
        return cls.from_miles_chains(miles, chains)

    @property
    def yards(self) -> float:
        return self.metres / METRES_PER_YARD

    @property
    def chains(self) -> float:
        return self.metres / METRES_PER_CHAIN

    def as_miles_chains(self) -> tuple[int, float]:
        miles = int(self.metres // METRES_PER_MILE)
        remainder = self.metres - miles * METRES_PER_MILE
        return miles, remainder / METRES_PER_CHAIN

    def __add__(self, other: Distance) -> Distance:
        return Distance(self.metres + other.metres)

    def __sub__(self, other: Distance) -> Distance:
        return Distance(self.metres - other.metres)

    def __mul__(self, factor: float) -> Distance:
        return Distance(self.metres * factor)

    def __abs__(self) -> Distance:
        return Distance(abs(self.metres))

    def __str__(self) -> str:
        miles, chains = self.as_miles_chains()
        return f"{miles}m {chains:.2f}ch"


#: Below this a train is standing, not creeping. Floating point arithmetic means
#: a train that has just been braked to a stand is rarely at exactly zero, and
#: four different answers to "is it moving" is three too many.
AT_A_STAND = 0.01


@dataclass(frozen=True, order=True)
class Speed:
    """A permissible or actual speed, held in metres per second."""

    mps: float

    @property
    def moving(self) -> bool:
        """Whether this counts as movement rather than arithmetic noise."""
        return self.mps > AT_A_STAND

    @property
    def stopped(self) -> bool:
        return not self.moving

    @classmethod
    def from_mph(cls, mph: float) -> Speed:
        if mph < 0:
            raise UnitError("speed cannot be negative")
        return cls(mph * MPH_TO_MPS)

    @property
    def mph(self) -> float:
        return self.mps / MPH_TO_MPS

    def __str__(self) -> str:
        return f"{self.mph:.0f} mph"


@dataclass(frozen=True)
class Gradient:
    """A gradient written as ``1 in N``, positive N meaning rising."""

    one_in: float

    @classmethod
    def level(cls) -> Gradient:
        return cls(float("inf"))

    @classmethod
    def parse(cls, text: str) -> Gradient:
        cleaned = text.strip().lower()
        if cleaned in {"level", "0", "flat"}:
            return cls.level()
        match = re.match(r"^1\s*in\s*(-?\d+(?:\.\d+)?)$", cleaned)
        if match is None:
            raise UnitError(f"cannot read {text!r} as a gradient")
        value = float(match.group(1))
        if value == 0:
            raise UnitError("a gradient of 1 in 0 is not a gradient")
        return cls(value)

    @property
    def per_mille(self) -> float:
        if self.one_in == float("inf"):
            return 0.0
        return 1000.0 / self.one_in

    @property
    def rising(self) -> bool:
        return self.one_in > 0 and self.one_in != float("inf")

    def __str__(self) -> str:
        if self.one_in == float("inf"):
            return "level"
        return f"1 in {self.one_in:g}"


def mileage(text: str) -> Distance:
    """Convenience wrapper so parsers read as ``mileage("12m 34ch")``."""
    return Distance.parse(text)
