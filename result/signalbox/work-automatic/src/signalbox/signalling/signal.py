"""Signals and the aspects they can show.

Aspects are ordered from most restrictive to least, which lets the aspect
sequencing code talk about "one step less restrictive than the signal in front"
without special casing every combination.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from ..errors import InterlockingError
from ..topology.position import Position


class Aspect(Enum):
    """What a running signal is displaying, worst first."""

    RED = 0
    YELLOW = 1
    DOUBLE_YELLOW = 2
    GREEN = 3

    @property
    def is_stop(self) -> bool:
        return self is Aspect.RED

    @property
    def is_proceed(self) -> bool:
        return self is not Aspect.RED

    def less_restrictive(self) -> Aspect:
        return Aspect(min(self.value + 1, Aspect.GREEN.value))

    def more_restrictive(self) -> Aspect:
        return Aspect(max(self.value - 1, Aspect.RED.value))

    def __str__(self) -> str:
        return {
            Aspect.RED: "R",
            Aspect.YELLOW: "Y",
            Aspect.DOUBLE_YELLOW: "YY",
            Aspect.GREEN: "G",
        }[self]


class SignalType(Enum):
    """The kind of signal, which decides what it may be used for."""

    MAIN = "main"
    SHUNT = "shunt"
    BANNER_REPEATER = "banner"

    @property
    def carries_main_routes(self) -> bool:
        return self is SignalType.MAIN

    @property
    def is_running_signal(self) -> bool:
        return self in (SignalType.MAIN, SignalType.BANNER_REPEATER)


#: Which aspects a signal of each head count may show.
ASPECTS_AVAILABLE = {
    2: (Aspect.RED, Aspect.GREEN),
    3: (Aspect.RED, Aspect.YELLOW, Aspect.GREEN),
    4: (Aspect.RED, Aspect.YELLOW, Aspect.DOUBLE_YELLOW, Aspect.GREEN),
}


@dataclass(frozen=True)
class Signal:
    """A signal post standing at a position and facing one way along the track."""

    name: str
    position: Position
    heads: int = 3
    type: SignalType = SignalType.MAIN
    subsidiary: bool = False
    automatic: bool = False
    attributes: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.type is SignalType.SHUNT:
            if self.heads != 2:
                raise InterlockingError(f"shunt signal {self.name} must be a two aspect signal")
        elif self.heads not in ASPECTS_AVAILABLE:
            raise InterlockingError(
                f"signal {self.name} has {self.heads} aspects, expected 2, 3 or 4"
            )
        if self.automatic and self.type is not SignalType.MAIN:
            raise InterlockingError(
                f"{self.name} cannot be an automatic {self.type.value} signal"
            )

    @property
    def edge(self) -> str:
        return self.position.edge

    @property
    def available(self) -> tuple[Aspect, ...]:
        return ASPECTS_AVAILABLE[self.heads]

    @property
    def best_aspect(self) -> Aspect:
        return self.available[-1]

    def can_show(self, aspect: Aspect) -> bool:
        return aspect in self.available

    def clamp(self, aspect: Aspect) -> Aspect:
        """The nearest aspect this signal can actually display, never brighter."""
        for candidate in reversed(self.available):
            if candidate.value <= aspect.value:
                return candidate
        return Aspect.RED

    def __str__(self) -> str:
        return self.name
