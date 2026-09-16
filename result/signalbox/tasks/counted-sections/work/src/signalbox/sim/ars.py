"""Automatic route setting: the signaller replaced by a rule.

Give each train the routes it is booked over and this asks for them as the train
gets near the signal that starts them. It is not a clever regulator: it does not
decide who goes first when two trains want the same junction, it simply asks in
the order the trains arrive and takes no for an answer. That is enough to run a
scheme against a timetable and see where it seizes up.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..units import Distance
from .driver import signal_ahead
from .log import EventKind
from .regulator import Candidate, Class, Regulator
from .state import RouteStatus
from .train import Train
from .world import World

#: How close to the signal a train has to be before its route is asked for.
SETTING_DISTANCE = Distance(1500.0)


@dataclass
class Booking:
    """The routes one train is booked over, in order."""

    train: str
    routes: list[str] = field(default_factory=list)
    done: int = 0
    klass: Class = Class.STOPPER
    asking_since: float | None = None

    @property
    def finished(self) -> bool:
        return self.done >= len(self.routes)

    @property
    def next_route(self) -> str | None:
        return None if self.finished else self.routes[self.done]

    def advance(self) -> None:
        self.done += 1
        self.asking_since = None

    def waiting(self, now: float) -> float:
        return 0.0 if self.asking_since is None else now - self.asking_since

    def __str__(self) -> str:
        left = len(self.routes) - self.done
        return f"{self.train}: {left} of {len(self.routes)} routes left"


@dataclass
class Ars:
    """Asks for the routes each train is booked over, as it comes to them."""

    world: World
    bookings: dict[str, Booking] = field(default_factory=dict)
    setting_distance: Distance = SETTING_DISTANCE
    regulator: Regulator = field(default_factory=Regulator)
    refused: int = 0
    granted: int = 0

    def book(self, train: str, routes: list[str], klass: Class = Class.STOPPER) -> Booking:
        booking = Booking(train, list(routes), klass=klass)
        self.bookings[train] = booking
        return booking

    def booking(self, train: str) -> Booking | None:
        return self.bookings.get(train)

    def step(self) -> list[str]:
        """Ask for whatever is wanted now, in the order the regulator decides."""
        granted: list[str] = []
        for candidate in self.regulator.order(self._candidates()):
            booking = self.bookings[candidate.train]
            if self.world.request(candidate.route):
                self.granted += 1
                booking.advance()
                granted.append(candidate.route)
            else:
                self.refused += 1
        return granted

    def _candidates(self) -> list[Candidate]:
        """Every request that could be made now, with what regulating needs."""
        now = self.world.clock
        found: list[Candidate] = []
        for name, booking in sorted(self.bookings.items()):
            train = self.world.trains.get(name)
            if train is None or booking.finished:
                continue
            route = booking.next_route
            assert route is not None
            if self._already_set(route):
                booking.advance()
                continue
            distance = self._distance_to(train, route)
            if distance is None:
                continue
            if booking.asking_since is None:
                booking.asking_since = now
            found.append(Candidate(name, route, booking.klass, booking.waiting(now), distance))
        return found

    def _already_set(self, route: str) -> bool:
        state = self.world.machine.state.route(route)
        return state.status in (RouteStatus.SET, RouteStatus.OCCUPIED)

    def _distance_to(self, train: Train, route: str) -> Distance | None:
        """How far the train is from the signal the route starts at, if it is near."""
        entrance = self.world.machine.interlocking.plan(route).entrance
        found = signal_ahead(self.world.scheme, train.front, self.world.lies())
        if found is None:
            return None
        name, distance = found
        if name != entrance or distance.metres > self.setting_distance.metres:
            return None
        return distance

    def run(self, seconds: float, step: float = 1.0) -> None:
        """Run the world for a while, setting routes as it goes."""
        end = self.world.clock + seconds
        while self.world.clock < end:
            for route in self.step():
                self.world.note(EventKind.ROUTE, route, "set by automatic route setting")
            self.world.step(step)

    def describe(self) -> str:
        outstanding = sum(1 for booking in self.bookings.values() if not booking.finished)
        return (
            f"{len(self.bookings)} trains booked, {outstanding} still running, "
            f"{self.granted} routes set, {self.refused} refusals"
        )
