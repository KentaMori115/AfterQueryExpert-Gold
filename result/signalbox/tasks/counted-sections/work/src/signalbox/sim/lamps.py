"""What every signal is showing, worked out from the state of the railway.

This used to live in the machine, which was already the biggest thing in the
package and did not need to know how an aspect sequence works as well as how a
route is set. The two are separable: setting a route changes the state, and what
the signals show follows from the state and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..signalling.aspects import AspectChart
from ..signalling.interlocking import Interlocking
from ..signalling.signal import Aspect
from ..topology.graph import Lie
from ..topology.scheme import Scheme
from .state import RouteStatus, SchemeState


@dataclass
class Lamps:
    """The aspects, and everything needed to work them out."""

    scheme: Scheme
    interlocking: Interlocking
    chart: AspectChart
    state: SchemeState

    def route_set_from(self, signal: str) -> str | None:
        """The route standing set from a signal, if there is one."""
        for plan in self.interlocking.from_signal(signal):
            if self.state.route(plan.name).status in (
                RouteStatus.SET,
                RouteStatus.OCCUPIED,
            ):
                return plan.name
        return None

    def points_to_prove(self, route: str) -> dict[str, Lie]:
        """The points that have to be detected before this signal will clear.

        The route's own points and its flank protection always count. The
        overlap counts only while this route is still holding it: once the route
        ahead has been set over the same track in the same direction, that route
        is holding it instead and is proving its own points there.
        """
        plan = self.interlocking.plan(route)
        wanted = dict(plan.points())
        wanted.update(plan.flank_points())
        still_ours = all(self.state.holder_of(sub) == route for sub in plan.overlap_track)
        if still_ours:
            wanted.update(plan.overlap_points())
        return wanted

    def aspect_of(self, signal: str, _seen: frozenset[str] = frozenset()) -> Aspect:
        """What a signal is showing, worked back from the one in front of it."""
        if signal in _seen or self.state.is_dark(signal):
            return Aspect.RED
        route = self.route_set_from(signal)
        if route is None:
            return Aspect.RED
        plan = self.interlocking.plan(route)
        if not plan.klass.clears_signal:
            return Aspect.RED
        if any(self.state.is_occupied(section) for section in plan.sections):
            return Aspect.RED
        if not all(
            self.state.lying(node, lie) for node, lie in self.points_to_prove(route).items()
        ):
            return Aspect.RED
        rule = self.chart.rule(route)
        if rule is None:
            return Aspect.RED
        if rule.ahead is None:
            return rule.shown(Aspect.RED)
        ahead = self.aspect_of(rule.ahead, _seen | {signal})
        return rule.shown(ahead)

    def refresh(self) -> None:
        """Work every signal out again and write the answers into the state."""
        for name in self.scheme.signals:
            self.state.aspects[name] = self.aspect_of(name)

    def showing(self, signal: str) -> Aspect:
        return self.state.aspects.get(signal, Aspect.RED)
