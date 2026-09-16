"""Train protection: where the grids go and what speed they are set at.

The train protection system puts two kinds of loop in the track. A train stop
grid sits at the signal and brakes anything that passes it at danger. An
overspeed grid sits back from the signal and brakes anything approaching too
fast to stop at it. The distance back is not a standard figure: it follows from
the set speed, the approach speed and the braking rate, which is why it is
calculated here rather than written into the plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance, Speed
from .braking import BrakingModel
from .signal import Signal, SignalType

#: The speed an overspeed grid is set to catch, in miles per hour.
DEFAULT_SET_SPEED = Speed.from_mph(35)

#: Emergency braking is harder than service braking.
EMERGENCY_BRAKING = 1.2

#: A signal on line slower than this does not need an overspeed grid.
OSS_THRESHOLD = Speed.from_mph(30)


class GridKind(Enum):
    TRAIN_STOP = "tss"
    OVERSPEED = "oss"

    @property
    def is_at_the_signal(self) -> bool:
        return self is GridKind.TRAIN_STOP

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Grid:
    """One pair of loops in the track."""

    name: str
    kind: GridKind
    position: Position
    set_speed: Speed | None = None
    behind: Distance = Distance(0.0)

    @property
    def signal(self) -> str:
        return self.name.split("-")[0]

    def describe(self) -> str:
        if self.kind is GridKind.TRAIN_STOP:
            return f"{self.name} at the signal"
        speed = self.set_speed or DEFAULT_SET_SPEED
        return f"{self.name} {self.behind.metres:.0f}m in rear, set at {speed}"

    def __str__(self) -> str:
        return self.describe()


def oss_distance(
    approach: Speed,
    set_speed: Speed = DEFAULT_SET_SPEED,
    *,
    rate: float = EMERGENCY_BRAKING,
) -> Distance:
    """How far back an overspeed grid goes for a given approach speed.

    A train doing the approach speed has to be brought down to the set speed by
    the time it reaches the signal, on the emergency brake.
    """
    if approach.mps <= set_speed.mps:
        return Distance(0.0)
    return Distance((approach.mps**2 - set_speed.mps**2) / (2.0 * rate))


def grids_for(
    scheme: Scheme,
    signal: Signal,
    *,
    set_speed: Speed = DEFAULT_SET_SPEED,
    model: BrakingModel | None = None,
) -> list[Grid]:
    """The grids a signal wants, nearest the signal first."""
    del model
    if signal.type is not SignalType.MAIN:
        return []

    found = [Grid(f"{signal.name}-TSS", GridKind.TRAIN_STOP, signal.position)]

    approach = scheme.graph.edge(signal.position.edge).speed
    if approach is None or approach.mps <= OSS_THRESHOLD.mps:
        return found

    behind = oss_distance(approach, set_speed)
    if behind.metres <= 0:
        return found

    found.append(
        Grid(
            f"{signal.name}-OSS",
            GridKind.OVERSPEED,
            signal.position,
            set_speed=set_speed,
            behind=behind,
        )
    )
    return found


def all_grids(scheme: Scheme, *, set_speed: Speed = DEFAULT_SET_SPEED) -> list[Grid]:
    found: list[Grid] = []
    for signal in scheme.sorted_signals():
        found.extend(grids_for(scheme, signal, set_speed=set_speed))
    return found


def signals_without_protection(scheme: Scheme) -> list[str]:
    """Main signals on fast line that get no overspeed grid."""
    missing = []
    for signal in scheme.sorted_signals():
        if signal.type is not SignalType.MAIN:
            continue
        kinds = {grid.kind for grid in grids_for(scheme, signal)}
        if GridKind.OVERSPEED not in kinds:
            missing.append(signal.name)
    return missing
