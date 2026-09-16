"""The interlocking itself, working.

A request to set a route is refused for exactly the reasons the control table
gives, and for no others. If this machine lets something through that the table
says it should not, one of the two is wrong, which is the whole point of having
both.

Setting a route goes: check, hold the track, call the points, wait for
detection, then clear the signal. Releasing goes the other way, section by
section behind the train, and a route that is cancelled with a train approaching
waits out its approach locking first.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field

from ..signalling.approach import ApproachLock, approach_lock_for
from ..signalling.aspects import AspectChart, build_chart
from ..signalling.conflict import build_matrix
from ..signalling.emergency import EmergencyRelease, release_for
from ..signalling.interlocking import Interlocking
from ..signalling.locking import LockingEntry, build_locking
from ..signalling.points import DEFAULT_THROW
from ..signalling.signal import Aspect
from ..topology.graph import Lie
from ..topology.scheme import Scheme
from .lamps import Lamps
from .state import PointState, RouteState, RouteStatus, SchemeState

#: Used only where a scheme says nothing about the machine at a set of points.
POINT_MOVE_SECONDS = DEFAULT_THROW


@dataclass(frozen=True)
class Outcome:
    """What happened when the signaller asked for something."""

    accepted: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.accepted

    def __str__(self) -> str:
        return "accepted" if self.accepted else f"refused: {self.reason}"


ACCEPTED = Outcome(True)


@dataclass
class Machine:
    """An interlocking that can be asked to do things."""

    scheme: Scheme
    interlocking: Interlocking
    state: SchemeState = field(default_factory=SchemeState)
    point_seconds: float | None = None
    _released: dict[str, set[str]] = field(default_factory=dict, repr=False)
    _entered: dict[str, set[str]] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self.matrix = build_matrix(self.interlocking)
        self.locking = build_locking(self.interlocking, self.matrix)
        self.chart: AspectChart = build_chart(self.scheme, self.interlocking)
        self.approach: dict[str, ApproachLock] = {
            plan.name: approach_lock_for(self.scheme, plan) for plan in self.interlocking
        }
        self.emergency: dict[str, EmergencyRelease] = {
            plan.name: release_for(
                plan.name,
                self.approach[plan.name],
                plan.klass,
                self.scheme.graph.edge(self.scheme.signal(plan.entrance).position.edge).speed,
            )
            for plan in self.interlocking
        }
        self._timers: dict[str, float] = {}
        self.lamps = Lamps(self.scheme, self.interlocking, self.chart, self.state)
        for name in self.scheme.graph.movable():
            self.state.points.setdefault(name, PointState(name))
        for plan in self.interlocking:
            self.state.routes.setdefault(plan.name, RouteState(plan.name))
            self._released.setdefault(plan.name, set())
            self._entered.setdefault(plan.name, set())
        self.refresh_aspects()

    # asking for things -------------------------------------------------

    def entry(self, route: str) -> LockingEntry:
        return self.locking.entry(route)

    def throw_time(self, points: str) -> float:
        """How long these points take to move, from the plan or the default."""
        if self.point_seconds is not None:
            return self.point_seconds
        machine = self.scheme.machines.get(points)
        return machine.throw if machine else self.scheme.standards.throw

    def setting_time(self, route: str) -> float:
        """How long the slowest set of points on a route takes to move."""
        wanted = self.entry(route).points
        return max((self.throw_time(node) for node in wanted), default=0.0)

    def would_refuse(self, route: str) -> Outcome:
        """Ask whether a route could be set, without setting it.

        Useful for explaining a refusal without having to work the interlocking
        backwards afterwards to find out what state it ended up in.
        """
        before = deepcopy(self.state)
        outcome = self.request(route)
        self.state = before
        self.lamps.state = before
        return outcome

    def request(self, route: str) -> Outcome:
        """Ask for a route to be set."""
        if route not in self.state.routes:
            return Outcome(False, f"no route called {route}")
        current = self.state.route(route)
        if current.held or current.status is RouteStatus.CALLED:
            return Outcome(False, f"{route} is already {current.status.value}")

        entry = self.entry(route)
        plan = self.interlocking.plan(route)

        for other in entry.locks_out:
            if self.state.route(other).held:
                return Outcome(False, f"{other} is set against it")

        for sub in plan.track:
            blocker = self.state.blocker_of(sub, route)
            if blocker is not None:
                return Outcome(False, f"{sub.name} is held by {blocker}")
        for sub in plan.overlap_track:
            blocker = self.state.blocker_of(sub, route, as_overlap=True)
            if blocker is not None:
                return Outcome(False, f"{sub.name} is held by {blocker}")

        if not plan.klass.permits_occupied_track:
            busy = [s for s in plan.sections if self.state.is_occupied(s)]
            if busy:
                return Outcome(False, f"{', '.join(busy)} is occupied")

        for node, lie in entry.points.items():
            points = self.state.point(node)
            if not points.status.usable and points.moving_to is not lie:
                return Outcome(False, f"{node} has failed")
            machine = self.scheme.machines.get(node)
            if machine is not None and not machine.can_be_called and not points.lying(lie):
                return Outcome(False, f"{node} is hand worked and lies the other way")

        self._hold(route, entry)
        return ACCEPTED

    def _hold(self, route: str, entry: LockingEntry) -> None:
        plan = self.interlocking.plan(route)
        for sub in plan.track:
            self.state.lock(sub, route)
        for sub in plan.overlap_track:
            if self.state.hold_on(sub) is None:
                self.state.lock(sub, route, overlap=True)
        for node, lie in entry.points.items():
            points = self.state.point(node)
            if points.lying(lie):
                continue
            points.start_moving(lie, self.throw_time(node))
        self.state.route(route).status = RouteStatus.CALLED
        self.state.route(route).set_at = self.state.clock
        self._released[route] = set()
        self._entered[route] = set()
        self._settle(route)

    def _settle(self, route: str) -> None:
        """Move a called route to set once every set of points is detected."""
        state = self.state.route(route)
        if state.status is not RouteStatus.CALLED:
            return
        entry = self.entry(route)
        if all(self.state.lying(node, lie) for node, lie in entry.points.items()):
            state.status = RouteStatus.SET
        self.refresh_aspects()

    def cancel(self, route: str) -> Outcome:
        """Ask for a route to be given up."""
        state = self.state.route(route)
        if not state.held and state.status is not RouteStatus.CALLED:
            return Outcome(False, f"{route} is not set")

        lock = self.approach[route]
        approaching = any(self.state.is_occupied(section) for section in lock.watched)
        showing = self.state.aspects.get(self.interlocking.plan(route).entrance, Aspect.RED)

        if approaching and showing.is_proceed and lock.kind.needs_timer:
            self._start_releasing(route, lock.delay)
            return Outcome(True, f"approach locked for {lock.delay:.0f}s")

        self._release(route)
        return ACCEPTED

    def emergency_release(self, route: str) -> Outcome:
        """Take a route away when nothing can be proved about the train.

        Unlike cancelling, this does not care whether anything is approaching:
        it always waits out the emergency timer, because the case it is for is
        the one where the track circuits cannot be believed.
        """
        state = self.state.route(route)
        if not state.held and state.status is not RouteStatus.CALLED:
            return Outcome(False, f"{route} is not set")

        release = self.emergency[route]
        if release.immediate:
            self._release(route)
            return ACCEPTED

        self._start_releasing(route, release.delay)
        return Outcome(True, f"emergency release running for {release.delay:.0f}s")

    def _start_releasing(self, route: str, delay: float) -> None:
        state = self.state.route(route)
        state.status = RouteStatus.RELEASING
        state.cancelled_at = self.state.clock
        self._timers[route] = delay
        self.refresh_aspects()

    def fail_points(self, name: str) -> Outcome:
        """Lose detection on a set of points, as a machine failure would."""
        points = self.state.point(name)
        points.fail()
        self.refresh_aspects()
        holders = [
            state.name
            for state in self.state.held_routes()
            if name in self.entry(state.name).points
        ]
        if holders:
            return Outcome(True, f"{name} failed under {', '.join(sorted(holders))}")
        return Outcome(True, f"{name} failed")

    def fail_signal(self, name: str) -> Outcome:
        """Lose the lamps at a signal.

        A driver who cannot see an aspect treats the signal as being at danger,
        and so does everything behind it, which is why this is worth simulating
        rather than assuming somebody will notice.
        """
        if name not in self.scheme.signals:
            return Outcome(False, f"no signal called {name}")
        self.state.darken(name)
        self.refresh_aspects()
        return Outcome(True, f"{name} is out")

    def relight_signal(self, name: str) -> Outcome:
        if name not in self.scheme.signals:
            return Outcome(False, f"no signal called {name}")
        self.state.relight(name)
        self.refresh_aspects()
        return Outcome(True, f"{name} is lit again")

    def fail_section(self, section: str) -> Outcome:
        """Lose a track circuit, so that it reads occupied whatever is on it."""
        self.state.fail_section(section)
        held = [
            state.name
            for state in self.state.held_routes()
            if any(
                sub.section == section
                for sub in self.interlocking.plan(state.name).held_track()
            )
        ]
        self.refresh_aspects()
        if held:
            return Outcome(True, f"{section} failed under {', '.join(sorted(held))}")
        return Outcome(True, f"{section} failed")

    def restore_section(self, section: str) -> Outcome:
        self.state.restore_section(section)
        self.refresh_aspects()
        return Outcome(True, f"{section} back in order")

    def restore_points(self, name: str) -> Outcome:
        """Get detection back, which is what somebody clipping the points does."""
        points = self.state.point(name)
        points.finish()
        for state in list(self.state.routes.values()):
            if state.status is RouteStatus.CALLED:
                self._settle(state.name)
        self.refresh_aspects()
        return Outcome(True, f"{name} detected {points.lie.value}")

    def _release(self, route: str) -> None:
        for sub in self.interlocking.plan(route).held_track():
            if self.state.holder_of(sub) == route:
                self.state.free(sub)
        state = self.state.route(route)
        state.status = RouteStatus.AVAILABLE
        state.set_at = None
        state.cancelled_at = None
        self._released[route] = set()
        self._entered[route] = set()
        self._timers.pop(route, None)
        self.refresh_aspects()

    # the world moving --------------------------------------------------

    def occupy(self, section: str) -> None:
        self.state.occupy(section)
        for state in self.state.held_routes():
            plan = self.interlocking.plan(state.name)
            if any(sub.section == section for sub in plan.held_track()):
                self._entered[state.name].add(section)
                if state.status is RouteStatus.SET:
                    state.status = RouteStatus.OCCUPIED
        self.refresh_aspects()

    def clear(self, section: str) -> None:
        self.state.clear(section)
        for state in list(self.state.held_routes()):
            entry = self.entry(state.name)
            plan = self.interlocking.plan(state.name)
            if section not in self._entered[state.name]:
                continue
            if not entry.is_sectional:
                continue
            for sub in plan.held_track():
                if sub.section == section and self.state.holder_of(sub) == state.name:
                    self.state.free(sub)
                    self._released[state.name].add(section)
            self._finish_if_done(state.name)
        self.refresh_aspects()

    def _finish_if_done(self, route: str) -> None:
        """A route is done when the train has cleared the track it runs over.

        The overlap goes with it. Waiting for a train to occupy and clear the
        overlap as well would mean a route that was never released, since the
        whole point of an overlap is that nothing goes into it.
        """
        wanted = {sub.section for sub in self.interlocking.plan(route).track}
        if wanted <= self._released[route]:
            self._release(route)

    def tick(self, seconds: float) -> None:
        """Let time pass: points finish moving and timers run down."""
        self.state.clock += seconds
        for points in self.state.moving_points():
            points.remaining -= seconds
            if points.remaining <= 0:
                points.finish()
        for state in list(self.state.routes.values()):
            if state.status is RouteStatus.CALLED:
                self._settle(state.name)
            elif (
                state.status is RouteStatus.RELEASING
                and state.cancelled_at is not None
                and self.state.clock - state.cancelled_at >= self._timers.get(state.name, 0.0)
            ):
                self._release(state.name)
        self.refresh_aspects()

    # aspects -----------------------------------------------------------

    def route_set_from(self, signal: str) -> str | None:
        return self.lamps.route_set_from(signal)

    def aspect_of(self, signal: str) -> Aspect:
        return self.lamps.aspect_of(signal)

    def refresh_aspects(self) -> None:
        self.lamps.refresh()

    def showing(self, signal: str) -> Aspect:
        return self.lamps.showing(signal)

    def _points_to_prove(self, route: str) -> dict[str, Lie]:
        return self.lamps.points_to_prove(route)

    def lie_of(self, points: str) -> Lie:
        return self.state.point(points).lie
