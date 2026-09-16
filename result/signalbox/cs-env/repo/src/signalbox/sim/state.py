"""The state of a working interlocking at one instant.

Everything here is deliberately dumb. It records what the points are doing, what
track is occupied, and which routes are set; it does not decide whether any of
that is allowed. The deciding happens in ``sim.machine``, which is the only
thing that should be changing this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from ..errors import InterlockingError
from ..signalling.signal import Aspect
from ..signalling.subroute import Subroute
from ..topology.graph import Lie


class PointStatus(Enum):
    """Where a set of points is, as the interlocking sees it."""

    DETECTED = "detected"
    MOVING = "moving"
    FAILED = "failed"

    @property
    def usable(self) -> bool:
        return self is PointStatus.DETECTED


class RouteStatus(Enum):
    """How far through its life a route is."""

    AVAILABLE = "available"
    CALLED = "called"
    SET = "set"
    OCCUPIED = "occupied"
    RELEASING = "releasing"

    @property
    def is_held(self) -> bool:
        """Whether the route is holding track and points at the moment."""
        return self in (RouteStatus.SET, RouteStatus.OCCUPIED, RouteStatus.RELEASING)


@dataclass
class PointState:
    """One set of points."""

    name: str
    lie: Lie = Lie.NORMAL
    status: PointStatus = PointStatus.DETECTED
    moving_to: Lie | None = None
    remaining: float = 0.0

    @property
    def detected(self) -> bool:
        return self.status.usable

    def lying(self, wanted: Lie) -> bool:
        return self.detected and self.lie is wanted

    def start_moving(self, to: Lie, seconds: float) -> None:
        self.status = PointStatus.MOVING
        self.moving_to = to
        self.remaining = seconds

    def finish(self) -> None:
        if self.moving_to is not None:
            self.lie = self.moving_to
        self.moving_to = None
        self.remaining = 0.0
        self.status = PointStatus.DETECTED

    def fail(self) -> None:
        self.status = PointStatus.FAILED
        self.moving_to = None
        self.remaining = 0.0

    def __str__(self) -> str:
        if self.status is PointStatus.MOVING:
            return f"{self.name} moving to {self.moving_to.value if self.moving_to else '?'}"
        return f"{self.name} {self.lie.value} ({self.status.value})"


@dataclass
class RouteState:
    """One route as the signaller sees it."""

    name: str
    status: RouteStatus = RouteStatus.AVAILABLE
    set_at: float | None = None
    cancelled_at: float | None = None

    @property
    def held(self) -> bool:
        return self.status.is_held

    def __str__(self) -> str:
        return f"{self.name} {self.status.value}"


@dataclass(frozen=True)
class Hold:
    """Who is holding a piece of track, and whether it is route or overlap.

    The difference matters when the next route along is asked for. Track a route
    is holding as its overlap can be taken over by a move going the same way,
    because that move is the train the overlap was there for. Track a route is
    running over cannot be taken over by anybody.
    """

    route: str
    overlap: bool = False

    @property
    def is_overlap(self) -> bool:
        return self.overlap

    def __str__(self) -> str:
        return f"{self.route} (overlap)" if self.overlap else self.route


@dataclass
class SchemeState:
    """Track, points, routes and aspects, all at one moment."""

    occupied: set[str] = field(default_factory=set)
    failed: set[str] = field(default_factory=set)
    dark: set[str] = field(default_factory=set)
    points: dict[str, PointState] = field(default_factory=dict)
    routes: dict[str, RouteState] = field(default_factory=dict)
    subroutes: dict[str, Hold] = field(default_factory=dict)
    aspects: dict[str, Aspect] = field(default_factory=dict)
    clock: float = 0.0

    # track ------------------------------------------------------------

    def occupy(self, section: str) -> None:
        self.occupied.add(section)

    def clear(self, section: str) -> None:
        self.occupied.discard(section)

    def is_occupied(self, section: str) -> bool:
        """Whether the interlocking believes there is something on this track.

        A failed track circuit shows occupied whether anything is on it or not,
        which is the whole difficulty with them: the interlocking is right to
        believe it and everybody on the ground knows it is wrong.
        """
        return section in self.occupied or section in self.failed

    def fail_section(self, section: str) -> None:
        self.failed.add(section)

    def restore_section(self, section: str) -> None:
        self.failed.discard(section)

    def has_failed(self, section: str) -> bool:
        return section in self.failed

    def all_clear(self, sections: tuple[str, ...]) -> bool:
        return not any(self.is_occupied(section) for section in sections)

    # signals ----------------------------------------------------------

    def darken(self, signal: str) -> None:
        """Lose the lamps at a signal, so that it shows nothing at all."""
        self.dark.add(signal)

    def relight(self, signal: str) -> None:
        self.dark.discard(signal)

    def is_dark(self, signal: str) -> bool:
        return signal in self.dark

    # points -----------------------------------------------------------

    def point(self, name: str) -> PointState:
        try:
            return self.points[name]
        except KeyError:
            raise InterlockingError(f"no points called {name}") from None

    def lying(self, name: str, wanted: Lie) -> bool:
        return self.point(name).lying(wanted)

    def moving_points(self) -> list[PointState]:
        return [p for p in self.points.values() if p.status is PointStatus.MOVING]

    # routes -----------------------------------------------------------

    def route(self, name: str) -> RouteState:
        try:
            return self.routes[name]
        except KeyError:
            raise InterlockingError(f"no route called {name}") from None

    def held_routes(self) -> list[RouteState]:
        return [state for state in self.routes.values() if state.held]

    # subroutes --------------------------------------------------------

    def lock(self, subroute: Subroute, route: str, *, overlap: bool = False) -> None:
        self.subroutes[subroute.name] = Hold(route, overlap)

    def free(self, subroute: Subroute) -> None:
        self.subroutes.pop(subroute.name, None)

    def hold_on(self, subroute: Subroute) -> Hold | None:
        return self.subroutes.get(subroute.name)

    def holder_of(self, subroute: Subroute) -> str | None:
        hold = self.subroutes.get(subroute.name)
        return hold.route if hold else None

    def locked_against(self, subroute: Subroute) -> str | None:
        """Who holds this piece of track in the opposite direction."""
        hold = self.subroutes.get(subroute.reverse.name)
        return hold.route if hold else None

    def blocker_of(
        self, subroute: Subroute, route: str, *, as_overlap: bool = False
    ) -> str | None:
        """Who stands in the way of ``route`` taking this piece of track.

        A hold in the other direction always does. In the same direction it
        depends on what each side wants it for: a route running over track
        another route is only holding as its overlap may take it, and an overlap
        may sit on top of anything going the same way, because the train it is
        there for is behind whatever else is holding it.
        """
        against = self.locked_against(subroute)
        if against is not None and against != route:
            return against
        hold = self.hold_on(subroute)
        if hold is None or hold.route == route or as_overlap or hold.is_overlap:
            return None
        return hold.route

    def held_by(self, route: str) -> list[str]:
        return sorted(name for name, hold in self.subroutes.items() if hold.route == route)

    # summary ----------------------------------------------------------

    def describe(self) -> str:
        set_routes = sorted(state.name for state in self.held_routes())
        failed = f", {len(self.failed)} failed" if self.failed else ""
        if self.dark:
            failed += f", {len(self.dark)} dark"
        return (
            f"t={self.clock:.0f}s "
            f"{len(self.occupied)} sections occupied, "
            f"{len(set_routes)} routes held{failed}"
        )
