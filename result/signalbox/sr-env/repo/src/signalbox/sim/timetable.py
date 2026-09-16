"""Running a service rather than a train.

One train through a junction tells you the interlocking works. A morning of them
tells you whether the scheme carries the service it was drawn for, which is a
different question and usually the one being argued about. A timetable is a list
of trains, when they turn up, and what they are booked over.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance, Speed
from .ars import Ars
from .regulator import Class
from .train import DEFAULT_LENGTH, Train
from .world import World, build_world


@dataclass(frozen=True)
class Service:
    """One booked train."""

    headcode: str
    at: float
    edge: str
    offset: float = 0.0
    routes: tuple[str, ...] = ()
    klass: Class = Class.STOPPER
    length: Distance = DEFAULT_LENGTH
    speed: Speed = field(default_factory=lambda: Speed.from_mph(20))
    booked: float | None = None

    def train(self) -> Train:
        return Train(
            name=self.headcode,
            front=Position(self.edge, Distance(self.offset)),
            length=self.length,
            speed=self.speed,
        )

    def __str__(self) -> str:
        return f"{self.headcode} ({self.klass}) enters {self.edge} at {self.at:.0f}s"


@dataclass(frozen=True)
class Working:
    """What one service actually did."""

    headcode: str
    entered: float
    finished: float | None
    edge: str
    routes_set: int
    booked: float | None = None

    @property
    def arrived(self) -> bool:
        return self.finished is not None

    @property
    def delay(self) -> float | None:
        if self.finished is None or self.booked is None:
            return None
        return self.finished - self.booked

    def __str__(self) -> str:
        if not self.arrived:
            return f"{self.headcode} did not finish, standing on {self.edge}"
        return f"{self.headcode} finished at {self.finished:.0f}s on {self.edge}"


@dataclass
class Timetable:
    services: list[Service] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.services)

    def __iter__(self) -> Iterator[Service]:
        return iter(self.services)

    def add(self, service: Service) -> Service:
        self.services.append(service)
        return service

    def due(self, from_time: float, to_time: float) -> list[Service]:
        return [s for s in self.services if from_time <= s.at < to_time]

    def span(self) -> tuple[float, float]:
        if not self.services:
            return (0.0, 0.0)
        times = [service.at for service in self.services]
        return (min(times), max(times))


@dataclass
class Result:
    """What the whole timetable did."""

    world: World
    ars: Ars
    workings: list[Working] = field(default_factory=list)

    @property
    def arrived(self) -> list[Working]:
        return [working for working in self.workings if working.arrived]

    @property
    def stuck(self) -> list[Working]:
        return [working for working in self.workings if not working.arrived]

    def late(self, by: float = 0.0) -> list[Working]:
        return [
            working
            for working in self.workings
            if working.delay is not None and working.delay > by
        ]

    def summary(self) -> str:
        return (
            f"{len(self.workings)} services, {len(self.arrived)} finished, "
            f"{len(self.stuck)} stuck, {self.ars.refused} refusals"
        )


def run_timetable(
    scheme: Scheme,
    timetable: Timetable,
    *,
    until: float = 1800.0,
    step: float = 2.0,
) -> Result:
    """Run every service and report what became of it."""
    world = build_world(scheme)
    ars = Ars(world)
    result = Result(world, ars)

    waiting = sorted(timetable.services, key=lambda service: service.at)
    entered: dict[str, float] = {}
    next_service = 0

    while world.clock < until:
        while next_service < len(waiting) and waiting[next_service].at <= world.clock:
            service = waiting[next_service]
            world.add(service.train())
            ars.book(service.headcode, list(service.routes), service.klass)
            entered[service.headcode] = world.clock
            next_service += 1
        ars.step()
        world.step(step)

    for service in timetable.services:
        booking = ars.booking(service.headcode)
        train = world.trains.get(service.headcode)
        done = booking is not None and booking.finished
        result.workings.append(
            Working(
                headcode=service.headcode,
                entered=entered.get(service.headcode, service.at),
                finished=world.clock if done else None,
                edge=train.front.edge if train else service.edge,
                routes_set=booking.done if booking else 0,
                booked=service.booked,
            )
        )
    return result
