"""Where every train was, at every step, so that a run can be drawn afterwards.

A simulation that only reports where things ended up is hard to argue with. A
record of where everything was the whole way through is what makes a train graph
possible, and a train graph is how anybody actually sees that two trains were
fighting over the same junction.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from ..topology.chainage import Chainage
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance, Speed


@dataclass(frozen=True)
class Fix:
    """Where one train was at one moment."""

    at: float
    train: str
    position: Position
    speed: Speed

    @property
    def edge(self) -> str:
        return self.position.edge

    def distance(self, scheme: Scheme, marks: Chainage) -> Distance | None:
        """The mileage of this fix, if the scheme has been dimensioned."""
        edge = scheme.graph.edge(self.position.edge)
        if not marks.known(edge.start.node):
            return None
        return marks.of(scheme, self.position)

    def __str__(self) -> str:
        return f"{self.at:7.1f}s {self.train} at {self.position} doing {self.speed}"


@dataclass
class History:
    """Every fix taken during a run, in the order they were taken."""

    fixes: list[Fix] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.fixes)

    def __iter__(self) -> Iterator[Fix]:
        return iter(self.fixes)

    def __bool__(self) -> bool:
        return bool(self.fixes)

    def record(self, at: float, train: str, position: Position, speed: Speed) -> Fix:
        fix = Fix(at, train, position, speed)
        self.fixes.append(fix)
        return fix

    def trains(self) -> list[str]:
        return sorted({fix.train for fix in self.fixes})

    def of(self, train: str) -> list[Fix]:
        return [fix for fix in self.fixes if fix.train == train]

    def at(self, moment: float) -> list[Fix]:
        """The last fix taken for each train at or before ``moment``."""
        latest: dict[str, Fix] = {}
        for fix in self.fixes:
            if fix.at <= moment:
                latest[fix.train] = fix
        return [latest[name] for name in sorted(latest)]

    def span(self) -> tuple[float, float]:
        if not self.fixes:
            return (0.0, 0.0)
        return (self.fixes[0].at, self.fixes[-1].at)

    def stops(self, train: str) -> list[Fix]:
        """Fixes where a train had come to a stand having been moving."""
        found = []
        previous: Fix | None = None
        for fix in self.of(train):
            if previous is not None and previous.speed.moving and fix.speed.stopped:
                found.append(fix)
            previous = fix
        return found

    def summary(self) -> str:
        if not self.fixes:
            return "nothing recorded"
        start, end = self.span()
        return (
            f"{len(self.fixes)} fixes for {len(self.trains())} trains over {end - start:.0f}s"
        )
