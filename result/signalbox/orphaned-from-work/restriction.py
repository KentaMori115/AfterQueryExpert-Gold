"""Temporary speed restrictions, and the braking they impose on the approach.

A slack is a piece of track that is good for less than the line speed for as
long as somebody says so. It changes two things. A train may not exceed it
anywhere inside the restricted stretch, and a train has to be brought down to
it before it gets there, which needs a warning board far enough back for the
braking to be done at the rate the scheme is drawn to.

How far back is not one number. Braking distance depends on the gradient of the
track a train brakes over, and which track that is depends on the distance, so
the answer is worked out a piece at a time: step back over the track in rear,
take the gradient that helps least of everything met so far, and stop at the
first place where what is behind is at least what the model asks for.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..layout.ast import RestrictionDecl
from ..topology.graph import Sense, TrackGraph
from ..topology.position import Position, advance
from ..topology.traverse import walk
from ..units import Distance, Gradient, Speed
from .braking import BrakingModel

if TYPE_CHECKING:  # pragma: no cover
    from ..topology.scheme import Scheme

#: How far back to look for room to brake before giving up on a restriction.
APPROACH_SEARCH = Distance(6000.0)


@dataclass(frozen=True)
class Restriction:
    """One temporary speed restriction, as a piece of the scheme."""

    name: str
    edge: str
    start: Distance
    end: Distance
    speed: Speed
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def length(self) -> Distance:
        return Distance(self.end.metres - self.start.metres)

    @property
    def reason(self) -> str:
        return self.attributes.get("reason", "")

    def covers(self, edge: str, offset: Distance) -> bool:
        """Whether a place on the layout is inside the restricted stretch."""
        if edge != self.edge:
            return False
        return self.start.metres <= offset.metres <= self.end.metres

    def entry(self) -> Position:
        """Where a train running the way the edge is drawn meets the slack."""
        return Position(self.edge, self.start, Sense.NOMINAL)

    def __str__(self) -> str:
        return (
            f"{self.name}: {self.edge} {self.start.metres:.0f}m to "
            f"{self.end.metres:.0f}m at {self.speed}"
        )


def restriction_from(decl: RestrictionDecl) -> Restriction:
    """Read a restriction off its declaration."""
    attributes = dict(decl.attributes)
    return Restriction(
        name=decl.name,
        edge=decl.edge,
        start=Distance(decl.start_metres),
        end=Distance(decl.end_metres),
        speed=Speed.from_mph(decl.speed_mph),
        attributes=attributes,
    )


def restrictions_over(
    restrictions: dict[str, Restriction], edge: str, offset: Distance
) -> list[Restriction]:
    """Every restriction covering one place, worst first then by name."""
    found = [r for r in restrictions.values() if r.covers(edge, offset)]
    return sorted(found, key=lambda r: (r.speed.mps, r.name))


def restricted_speed(
    restrictions: dict[str, Restriction],
    edge: str,
    offset: Distance,
    line: Speed | None = None,
) -> Speed | None:
    """The lowest of the line speed and every restriction over a place."""
    speeds = [r.speed for r in restrictions_over(restrictions, edge, offset)]
    if line is not None:
        speeds.append(line)
    if not speeds:
        return None
    return min(speeds, key=lambda s: s.mps)


def fastest_on(
    restrictions: dict[str, Restriction],
    edge: str,
    length: Distance,
    line: Speed | None,
) -> Speed | None:
    """The highest speed permitted anywhere along one edge.

    A restriction over part of an edge leaves the rest of it at line speed, so
    the answer only drops where restrictions cover the whole of it. The edge is
    cut at every restriction end and the fastest piece wins.
    """
    covering = [r for r in restrictions.values() if r.edge == edge]
    if not covering:
        return line
    cuts = {0.0, length.metres}
    for restriction in covering:
        cuts.add(max(restriction.start.metres, 0.0))
        cuts.add(min(restriction.end.metres, length.metres))
    ordered = sorted(cuts)
    best: Speed | None = None
    for before, after in zip(ordered, ordered[1:], strict=False):
        middle = Distance((before + after) / 2.0)
        here = restricted_speed(restrictions, edge, middle, line)
        if here is None:
            return line
        if best is None or here.mps > best.mps:
            best = here
    return best if best is not None else line


@dataclass(frozen=True)
class Approach:
    """The braking run a train makes on its way into a restriction."""

    restriction: str
    from_speed: Speed
    to_speed: Speed
    distance: Distance
    gradient: Gradient
    board: Position | None = None

    @property
    def has_room(self) -> bool:
        """Whether the scheme holds enough track in rear to do the braking."""
        return self.board is not None

    @property
    def needed(self) -> bool:
        """Whether the restriction asks a train to slow down at all."""
        return self.to_speed.mps < self.from_speed.mps

    def describe(self) -> str:
        where = str(self.board) if self.board is not None else "off the end of the scheme"
        return (
            f"{self.from_speed} to {self.to_speed} in "
            f"{self.distance.metres:.0f}m at {self.gradient}, board at {where}"
        )

    def __str__(self) -> str:
        return f"{self.restriction}: {self.describe()}"


def _met_by_a_train(edge_gradient: Gradient, walked: Sense) -> Gradient:
    """The gradient a train meets, given the sense the walk back used.

    Gradients are written for the down direction, so a train running against
    the way an edge was drawn climbs where the edge falls. The walk goes the
    opposite way to the train, which puts the train on the sense this step did
    not use.
    """
    if walked is Sense.REVERSE:
        return edge_gradient
    if edge_gradient.one_in == float("inf"):
        return edge_gradient
    return Gradient(-edge_gradient.one_in)


def _worse(first: Gradient, second: Gradient) -> Gradient:
    """Of two gradients, the one that helps braking least."""
    return second if second.per_mille < first.per_mille else first


def approach_for(
    scheme: Scheme,
    restriction: Restriction,
    *,
    model: BrakingModel | None = None,
    search: Distance = APPROACH_SEARCH,
) -> Approach:
    """Work out the braking run into ``restriction`` and where its board goes.

    The train comes from the line speed of the track the restriction is on and
    has to be at the restricted speed by the time it reaches the first metre of
    it. Each piece of track in rear is taken in turn, worst gradient so far
    deciding the rate, until there is room enough behind for the distance the
    model is asking for at that gradient.
    """
    graph: TrackGraph = scheme.graph
    model = model or BrakingModel(rate=scheme.standards.braking, reaction=scheme.standards.reaction)
    line = graph.edge(restriction.edge).speed
    entry = restriction.entry()

    if line is None or line.mps <= restriction.speed.mps:
        return Approach(
            restriction=restriction.name,
            from_speed=line or restriction.speed,
            to_speed=restriction.speed,
            distance=Distance(0.0),
            gradient=Gradient.level(),
            board=entry,
        )

    worst = Gradient.level()
    wanted = model.distance_to_slow(line, restriction.speed, worst)
    behind = 0.0

    for step in walk(graph, entry.reversed, limit=search):
        worst = _worse(worst, _met_by_a_train(graph.edge(step.edge).gradient, step.sense))
        wanted = model.distance_to_slow(line, restriction.speed, worst)
        behind += step.remaining(graph).metres
        if behind >= wanted.metres:
            board = advance(graph, entry.reversed, wanted)
            return Approach(
                restriction=restriction.name,
                from_speed=line,
                to_speed=restriction.speed,
                distance=wanted,
                gradient=worst,
                board=board.reversed if board is not None else None,
            )

    return Approach(
        restriction=restriction.name,
        from_speed=line,
        to_speed=restriction.speed,
        distance=wanted,
        gradient=worst,
        board=None,
    )
