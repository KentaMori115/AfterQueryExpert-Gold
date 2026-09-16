"""How far a train takes to stop, which is what decides where signals go.

Signal spacing is not a matter of taste. A driver who sees a caution must be
able to stop at the signal after it, from line speed, on the gradient that is
actually there. Everything else about aspect sequencing follows from this
module.

The model is the usual one: a constant service braking rate, adjusted for
gradient, with a reaction allowance in front of it. It is deliberately not a
train performance simulator. Signal engineers work to a braking rate agreed for
the route and so does this.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..units import Distance, Gradient, Speed

#: Acceleration due to gravity, used to turn a gradient into a braking effect.
G = 9.80665

#: The service braking rate British schemes are normally drawn to, in m/s^2.
SERVICE_BRAKING = 0.45

#: How long a driver takes to react to a caution before braking begins.
REACTION_SECONDS = 4.0

#: Nothing is flat, but a scheme that says nothing about a gradient is treated
#: as though it were, and one shared object saves making a new one every call.
LEVEL = Gradient.level()


@dataclass(frozen=True)
class BrakingModel:
    """The braking assumptions a scheme is designed to."""

    rate: float = SERVICE_BRAKING
    reaction: float = REACTION_SECONDS

    def effective_rate(self, gradient: Gradient) -> float:
        """Braking rate once the gradient has helped or hindered.

        A rising gradient adds to the retardation, a falling one takes away from
        it. The result is floored well above zero so that an absurd gradient
        gives a very long distance rather than an infinite one.
        """
        adjusted = self.rate + G * gradient.per_mille / 1000.0
        return max(adjusted, 0.05)

    def stopping_distance(self, speed: Speed, gradient: Gradient = LEVEL) -> Distance:
        """Reaction distance plus braking distance from ``speed`` to a stand."""
        reaction = speed.mps * self.reaction
        braking = (speed.mps**2) / (2.0 * self.effective_rate(gradient))
        return Distance(reaction + braking)

    def speed_after(self, speed: Speed, over: Distance, gradient: Gradient = LEVEL) -> Speed:
        """Speed left after braking for ``over``, or a stand if it runs out."""
        rate = self.effective_rate(gradient)
        squared = speed.mps**2 - 2.0 * rate * max(over.metres, 0.0)
        return Speed(squared**0.5) if squared > 0 else Speed(0.0)

    def time_to_stop(self, speed: Speed, gradient: Gradient = LEVEL) -> float:
        return self.reaction + speed.mps / self.effective_rate(gradient)


def required_spacing(
    speed: Speed,
    heads: int,
    *,
    gradient: Gradient = LEVEL,
    model: BrakingModel | None = None,
) -> Distance:
    """The shortest a block may be for a signal of this many heads.

    A three aspect signal gives one block of warning, so the block itself must
    hold the whole braking distance. A four aspect signal gives two, so each
    block need only hold half of it, which is how four aspect signalling buys
    capacity. A two aspect signal warns of nothing and is only used where the
    next signal can be seen from it.
    """
    model = model or BrakingModel()
    full = model.stopping_distance(speed, gradient)
    if heads >= 4:
        return Distance(full.metres / 2.0)
    if heads == 3:
        return full
    return Distance(full.metres * 1.5)


def headway_seconds(
    speed: Speed,
    block: Distance,
    train_length: Distance,
    *,
    heads: int = 4,
) -> float:
    """Rough headway between following trains at ``speed``.

    A train must clear its own length plus the blocks the signalling makes it
    wait for. It is a planning figure, not a timetable.
    """
    blocks = 2 if heads >= 4 else 1
    distance = block.metres * (blocks + 1) + train_length.metres
    if speed.mps <= 0:
        raise ValueError("headway at a stand is not a useful number")
    return distance / speed.mps
