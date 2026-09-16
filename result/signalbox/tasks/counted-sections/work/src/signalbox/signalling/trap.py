"""Trap points and derailers, which stop a runaway reaching the main line.

A siding joining a running line is a hazard whether or not anything is signalled
out of it. A trap set against the running line turns a runaway into a derailment
inside the siding, which is the whole point: the alternative is a derailment on
the main line under a passenger train.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..layout.ast import Facing, TrapDecl
from ..topology.graph import Sense
from ..topology.position import Position
from ..units import Distance

_SENSE_OF_FACING = {Facing.FORWARD: Sense.NOMINAL, Facing.BACKWARD: Sense.REVERSE}


@dataclass(frozen=True)
class Trap:
    """One derailer or set of trap points, facing one way along its edge."""

    name: str
    position: Position
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def edge(self) -> str:
        return self.position.edge

    @property
    def sense(self) -> Sense:
        return self.position.sense

    def catches(self, sense: Sense) -> bool:
        """Whether a movement running in ``sense`` would be thrown off here."""
        return sense is self.sense

    def is_between(self, start: Distance, end: Distance) -> bool:
        low, high = sorted((start.metres, end.metres))
        return low <= self.position.offset.metres <= high

    def __str__(self) -> str:
        return f"{self.name} on {self.position}"


def trap_from(decl: TrapDecl) -> Trap:
    return Trap(
        name=decl.name,
        position=Position(
            decl.edge, Distance(decl.offset_metres), _SENSE_OF_FACING[decl.facing]
        ),
        attributes=dict(decl.attributes),
    )


def traps_on(traps: dict[str, Trap], edge: str) -> list[Trap]:
    found = [trap for trap in traps.values() if trap.edge == edge]
    return sorted(found, key=lambda trap: trap.position.offset.metres)


def catching(traps: dict[str, Trap], edge: str, sense: Sense) -> list[Trap]:
    """Traps on an edge that would catch a movement running in ``sense``."""
    return [trap for trap in traps_on(traps, edge) if trap.catches(sense)]
