"""Emergency route release, for when the signaller has to take a route away.

Normal cancellation waits out the approach locking. Emergency release is what
the signaller reaches for when that is not good enough: something is on the
track that should not be, or a train has failed and has to be got out the other
way. It still waits, because a driver may still be braking on the strength of
the aspect, but it waits on a timer that runs whatever the track circuits say.

The timer is longer than the approach release for the same route, because it is
being used in the case where nothing can be proved about where the train is.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..units import Speed
from .approach import ApproachLock
from .route import RouteClass

#: The shortest an emergency release timer is ever set, in seconds.
MINIMUM_DELAY = 120.0

#: How much longer than the approach release the emergency timer runs.
MARGIN = 1.5


@dataclass(frozen=True)
class EmergencyRelease:
    """The emergency release arrangements for one route."""

    route: str
    delay: float
    reason: str = ""

    @property
    def immediate(self) -> bool:
        return self.delay <= 0

    def describe(self) -> str:
        if self.immediate:
            return "released at once"
        return f"released after {self.delay:.0f}s"

    def __str__(self) -> str:
        return f"{self.route}: {self.describe()}"


def delay_for(
    approach: ApproachLock,
    klass: RouteClass,
    speed: Speed | None = None,
    *,
    minimum: float = MINIMUM_DELAY,
) -> float:
    """How long an emergency release has to wait for one route.

    A route that does not clear a signal has nothing to take away from a driver,
    so it comes back at once. Everything else waits at least the minimum, and
    longer where the approach release was longer or the line is fast.
    """
    if not klass.clears_signal:
        return 0.0
    wanted = max(minimum, approach.delay * MARGIN)
    if speed is not None:
        wanted = max(wanted, speed.mph * 2.5)
    return wanted


def release_for(
    route: str,
    approach: ApproachLock,
    klass: RouteClass,
    speed: Speed | None = None,
) -> EmergencyRelease:
    delay = delay_for(approach, klass, speed)
    reason = "nothing to take away" if delay <= 0 else "a driver may already have seen it"
    return EmergencyRelease(route, delay, reason)
