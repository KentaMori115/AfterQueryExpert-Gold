"""What is actually on the ground at a set of points.

A set of points in the control table is a name and a position. On site it is a
machine with a throw time, detection contacts, and on a facing move a lock that
has to be proved home before anything clears. All three matter: the throw time
decides how long route setting takes, the detection decides what happens when it
fails, and the lock decides whether the points may carry passenger trains
through the toe at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..errors import InterlockingError
from ..layout.ast import NodeDecl, NodeKind

#: How long a set of points takes to throw and detect if nothing else is said.
DEFAULT_THROW = 6.0

#: Anything slower than this holds up route setting enough to be worth knowing.
SLOW_THROW = 12.0

_TRUTHY = {"yes", "true", "1"}


class Motor(Enum):
    """The kind of machine driving the blades."""

    ELECTRIC = "electric"
    HYDRAULIC = "hydraulic"
    HAND = "hand"

    @property
    def is_worked_from_the_box(self) -> bool:
        return self is not Motor.HAND

    @classmethod
    def from_word(cls, word: str) -> Motor | None:
        for member in cls:
            if member.value == word:
                return member
        return None


@dataclass(frozen=True)
class PointsMachine:
    """One set of points as a piece of equipment."""

    name: str
    throw: float = DEFAULT_THROW
    motor: Motor = Motor.ELECTRIC
    locked: bool = True
    detected: bool = True

    @property
    def is_slow(self) -> bool:
        return self.throw > SLOW_THROW

    @property
    def can_be_called(self) -> bool:
        """Whether the interlocking can move these points itself."""
        return self.motor.is_worked_from_the_box

    def describe(self) -> str:
        parts = [f"{self.motor.value}", f"{self.throw:.1f}s"]
        if self.locked:
            parts.append("locked")
        if not self.detected:
            parts.append("no detection")
        return ", ".join(parts)

    def __str__(self) -> str:
        return f"{self.name}: {self.describe()}"


def machine_from(decl: NodeDecl) -> PointsMachine:
    """Read the equipment settings off a points declaration."""
    if decl.kind not in (NodeKind.POINTS, NodeKind.SLIP):
        raise InterlockingError(
            f"{decl.name} is a {decl.kind.value}, not something that can be moved"
        )
    attributes = decl.attributes
    raw = attributes.get("throw", DEFAULT_THROW)
    try:
        throw = float(raw)
    except ValueError:
        raise InterlockingError(f"{decl.name} has a throw time of {raw!r}") from None
    if throw <= 0:
        raise InterlockingError(f"{decl.name} cannot throw in {throw}s")

    word = attributes.get("motor", "electric")
    motor = Motor.from_word(word)
    if motor is None:
        raise InterlockingError(f"{decl.name} has an unknown motor {word!r}")

    return PointsMachine(
        name=decl.name,
        throw=throw,
        motor=motor,
        locked=attributes.get("lock", "yes").lower() in _TRUTHY,
        detected=attributes.get("detection", "yes").lower() in _TRUTHY,
    )


def slowest(machines: dict[str, PointsMachine]) -> PointsMachine | None:
    """The machine that holds route setting up the most."""
    if not machines:
        return None
    return max(machines.values(), key=lambda m: m.throw)


def setting_time(machines: dict[str, PointsMachine], wanted: list[str]) -> float:
    """How long a route takes to set, given the points it calls.

    They move together, so it is the slowest one that decides, not the sum.
    """
    times = [machines[name].throw for name in wanted if name in machines]
    return max(times, default=0.0)
