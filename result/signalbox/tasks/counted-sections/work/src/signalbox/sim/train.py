"""A train: somewhere to be, a length, and a speed.

The front of the train is the position that matters for signalling. The back
matters too, because a route does not release until the whole train is out of a
section, and a train that is longer than the section it is standing in occupies
two of them.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from ..errors import TopologyError
from ..topology.graph import TrackGraph
from ..topology.position import Lies, Position, advance
from ..topology.scheme import Scheme
from ..units import Distance, Speed

#: A four car unit, which is what most of the traffic is.
DEFAULT_LENGTH = Distance(80.0)


@dataclass
class Train:
    """One train, on the track, facing one way."""

    name: str
    front: Position
    length: Distance = DEFAULT_LENGTH
    speed: Speed = Speed(0.0)
    max_speed: Speed = field(default_factory=lambda: Speed.from_mph(75))
    stopped_at: str | None = None

    @property
    def moving(self) -> bool:
        return self.speed.moving

    def rear(self, graph: TrackGraph) -> Position:
        """Where the back of the train is, or the front if it has run off."""
        back = advance(graph, self.front.reversed, self.length)
        return back.reversed if back is not None else self.front

    def edges_under(self, graph: TrackGraph) -> list[str]:
        """Every edge the train is standing on, front first."""
        seen: list[str] = [self.front.edge]
        here = self.front.reversed
        left = self.length.metres
        while left > 0:
            step = here.remaining(graph).metres
            if left <= step:
                break
            left -= step
            moved = advance(graph, here, Distance(step + 0.001))
            if moved is None:
                break
            here = moved
            if here.edge not in seen:
                seen.append(here.edge)
        return seen

    def sections_under(self, scheme: Scheme) -> list[str]:
        """The sections the train is occupying, front first, without repeats."""
        found: list[str] = []
        for edge in self.edges_under(scheme.graph):
            name = scheme.sections.name_for(edge)
            if name is not None and name not in found:
                found.append(name)
        return found

    def move(self, graph: TrackGraph, distance: Distance, lies: Lies | None = None) -> bool:
        """Run the train forward. False means it ran out of track and stopped."""
        if distance.metres < 0:
            raise TopologyError("a train cannot be moved backwards, turn it round instead")
        moved = advance(graph, self.front, distance, lies)
        if moved is None:
            self.speed = Speed(0.0)
            return False
        self.front = moved
        return True

    def accelerate(self, to: Speed, seconds: float, rate: float = 0.5) -> None:
        """Change speed towards ``to`` at ``rate`` metres per second squared."""
        step = rate * seconds
        if to.mps > self.speed.mps:
            self.speed = Speed(min(to.mps, self.speed.mps + step))
        else:
            self.speed = Speed(max(to.mps, self.speed.mps - step))

    def stop(self, at: str | None = None) -> None:
        self.speed = Speed(0.0)
        self.stopped_at = at

    def turned_round(self, graph: TrackGraph | None = None) -> Train:
        """The same train facing the other way, which is what a reversal is.

        The front becomes the back. Given the graph, the new front is worked out
        properly, which matters for a train longer than the piece of track it is
        standing on; without it the train pivots about its own front, which is
        near enough for a short one.
        """
        if graph is None:
            return replace(self, front=self.front.reversed, speed=Speed(0.0))
        return replace(self, front=self.rear(graph).reversed, speed=Speed(0.0))

    def rear_facing_back(self) -> Position:
        return self.front.reversed

    def __str__(self) -> str:
        return f"{self.name} at {self.front} doing {self.speed}"
