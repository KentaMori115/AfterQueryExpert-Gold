"""Trains, an interlocking, and a clock, all running together.

One step of the world is: look at what each driver can see, choose a speed, move
the train, work out what track it is standing on now, and tell the interlocking.
The interlocking then does what it does, which changes what the drivers can see
on the next step.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..layout.ast import NodeKind
from ..signalling.signal import Aspect
from ..topology.position import Lies
from ..topology.scheme import Scheme
from ..units import Distance, Speed
from .driver import Driver, Sighting, signal_ahead
from .history import History
from .log import EventKind, EventLog
from .machine import Machine
from .train import Train

#: A train that has been at a stand this long in front of a red is stuck.
STUCK_AFTER = 600.0


@dataclass
class World:
    """Everything that is going on at once."""

    scheme: Scheme
    machine: Machine
    driver: Driver = field(default_factory=Driver)
    trains: dict[str, Train] = field(default_factory=dict)
    log: EventLog = field(default_factory=EventLog)
    history: History = field(default_factory=History)
    _occupied: dict[str, list[str]] = field(default_factory=dict, repr=False)

    @property
    def clock(self) -> float:
        return self.machine.state.clock

    def add(self, train: Train) -> Train:
        """Put a train on the track and tell the interlocking it is there."""
        if train.name in self.trains:
            raise KeyError(f"{train.name} is already on the layout")
        self.trains[train.name] = train
        self._occupied[train.name] = []
        self._settle(train)
        self.note(EventKind.TRAIN, train.name, f"enters at {train.front}")
        self.history.record(self.clock, train.name, train.front, train.speed)
        return train

    def remove(self, name: str) -> None:
        """Take a train off the layout and give up the track it was standing on."""
        train = self.trains.pop(name, None)
        if train is None:
            return
        for section in self._occupied.pop(name, []):
            if not self._anyone_on(section):
                self.machine.clear(section)
        self.note(EventKind.TRAIN, name, "leaves")

    def train(self, name: str) -> Train:
        try:
            return self.trains[name]
        except KeyError:
            raise KeyError(f"no train called {name}") from None

    # what the drivers can see -----------------------------------------

    def lies(self) -> Lies:
        return {name: points.lie for name, points in self.machine.state.points.items()}

    def sighting_for(self, train: Train) -> Sighting | None:
        found = signal_ahead(self.scheme, train.front, self.lies())
        if found is None:
            return None
        name, distance = found
        return Sighting(name, distance, self.machine.showing(name))

    def line_speed(self, train: Train) -> Speed:
        edge = self.scheme.graph.edge(train.front.edge)
        limit = edge.speed or train.max_speed
        return Speed(min(limit.mps, train.max_speed.mps))

    # running ----------------------------------------------------------

    def step(self, seconds: float) -> None:
        """Advance the whole world by ``seconds``."""
        for train in list(self.trains.values()):
            self._drive(train, seconds)
        self.machine.tick(seconds)
        self.record()

    def record(self) -> None:
        """Take a fix on every train, for the record."""
        for name in sorted(self.trains):
            train = self.trains[name]
            self.history.record(self.clock, name, train.front, train.speed)

    def _drive(self, train: Train, seconds: float) -> None:
        sighting = self.sighting_for(train)
        target = self.driver.target_speed(self.line_speed(train), sighting)
        train.accelerate(target, seconds)

        room = self._room_ahead(sighting)
        travel = train.speed.mps * seconds
        if room is not None and travel > room:
            travel = max(room, 0.0)
            train.stop(at=sighting.signal if sighting else None)
            if sighting is not None:
                self.note(EventKind.TRAIN, train.name, f"stands at {sighting.signal}")

        if travel > 0 and not train.move(self.scheme.graph, Distance(travel), self.lies()):
            if self._at_a_boundary(train):
                self.remove(train.name)
                return
            self.note(EventKind.TRAIN, train.name, f"runs out of track at {train.front}")
        self._settle(train)

    def _at_a_boundary(self, train: Train) -> bool:
        """Whether the train has run up to the edge of the scheme, not a buffer."""
        edge = self.scheme.graph.edge(train.front.edge)
        far = edge.port_for(train.front.sense)
        return self.scheme.graph.node(far.node).kind is NodeKind.BOUNDARY

    def _room_ahead(self, sighting: Sighting | None) -> float | None:
        if sighting is None or sighting.aspect is not Aspect.RED:
            return None
        return sighting.distance.metres - self.driver.margin.metres

    def _settle(self, train: Train) -> None:
        """Tell the interlocking which sections this train is standing on."""
        was = self._occupied.get(train.name, [])
        now = train.sections_under(self.scheme)
        for section in now:
            if section not in was:
                self.machine.occupy(section)
        self._occupied[train.name] = now
        for section in was:
            if section not in now and not self._anyone_on(section):
                self.machine.clear(section)

    def _anyone_on(self, section: str) -> bool:
        return any(section in sections for sections in self._occupied.values())

    # asking for things ------------------------------------------------

    def request(self, route: str) -> bool:
        outcome = self.machine.request(route)
        self.note(EventKind.ROUTE, route, f"requested, {outcome}")
        return bool(outcome)

    def cancel(self, route: str) -> bool:
        outcome = self.machine.cancel(route)
        self.note(EventKind.ROUTE, route, f"cancelled, {outcome}")
        return bool(outcome)

    def emergency_release(self, route: str) -> bool:
        outcome = self.machine.emergency_release(route)
        self.note(EventKind.ROUTE, route, f"emergency release, {outcome}")
        return bool(outcome)

    def fail_points(self, points: str) -> bool:
        outcome = self.machine.fail_points(points)
        self.note(EventKind.POINTS, points, f"failed, {outcome}")
        return bool(outcome)

    def stop_train(self, name: str) -> bool:
        """Bring a train to a stand where it is, as a signaller would ask."""
        train = self.trains.get(name)
        if train is None:
            return False
        train.stop()
        self.note(EventKind.TRAIN, name, f"brought to a stand at {train.front}")
        return True

    def reverse(self, name: str) -> bool:
        """Turn a train round where it stands.

        A reversal is not a move, so it happens at once and at a stand. What it
        changes is which way the driver is looking, and therefore which signals
        the train is being worked by.
        """
        train = self.trains.get(name)
        if train is None:
            return False
        if train.moving:
            self.note(EventKind.TRAIN, name, "cannot reverse while it is moving")
            return False
        turned = train.turned_round(self.scheme.graph)
        self.trains[name] = turned
        self._settle(turned)
        self.note(EventKind.TRAIN, name, f"reverses, now facing {turned.front}")
        return True

    def fail_signal(self, signal: str) -> bool:
        outcome = self.machine.fail_signal(signal)
        self.note(EventKind.SIGNAL, signal, f"lamps out, {outcome}")
        return bool(outcome)

    def relight_signal(self, signal: str) -> bool:
        outcome = self.machine.relight_signal(signal)
        self.note(EventKind.SIGNAL, signal, f"relit, {outcome}")
        return bool(outcome)

    def fail_section(self, section: str) -> bool:
        outcome = self.machine.fail_section(section)
        self.note(EventKind.TRACK, section, f"failed, {outcome}")
        return bool(outcome)

    def restore_section(self, section: str) -> bool:
        outcome = self.machine.restore_section(section)
        self.note(EventKind.TRACK, section, f"restored, {outcome}")
        return bool(outcome)

    def restore_points(self, points: str) -> bool:
        outcome = self.machine.restore_points(points)
        self.note(EventKind.POINTS, points, f"restored, {outcome}")
        return bool(outcome)

    def note(self, kind: EventKind, subject: str, message: str) -> None:
        self.log.add(self.clock, kind, subject, message)

    def occupancy(self) -> set[str]:
        return set(self.machine.state.occupied)

    def describe(self) -> str:
        moving = sum(1 for train in self.trains.values() if train.moving)
        return (
            f"t={self.clock:.0f}s {len(self.trains)} trains, {moving} moving, "
            f"{len(self.occupancy())} sections occupied"
        )


def build_world(scheme: Scheme, machine: Machine | None = None) -> World:
    from ..signalling.interlocking import build_interlocking

    return World(scheme, machine or Machine(scheme, build_interlocking(scheme)))
