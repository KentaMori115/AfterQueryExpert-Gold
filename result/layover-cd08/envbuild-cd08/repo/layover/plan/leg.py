"""The legs a journey is made of, and the journey itself.

A leg is either a ride on one vehicle or a walk between two stops. A journey is
a sequence of legs that join up: each one starts where the last one ended, and
never earlier than the last one finished.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence, Tuple

from layover.errors import PlanError
from layover.times import format_duration, format_short

__all__ = ["Journey", "Leg", "LegKind"]


class LegKind(Enum):
    """What the passenger is doing on this leg."""

    RIDE = "ride"
    WALK = "walk"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Leg:
    """One ride or one walk."""

    kind: LegKind
    from_stop: str
    to_stop: str
    departure: int
    arrival: int
    route_id: Optional[str] = None
    trip_id: Optional[str] = None
    pattern_id: Optional[str] = None
    headsign: str = ""
    intermediate: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.arrival < self.departure:
            raise PlanError(
                "a leg from %r to %r arrives before it leaves" % (self.from_stop, self.to_stop)
            )
        if self.kind is LegKind.RIDE and not self.route_id:
            raise PlanError("a ride needs a route")
        if self.kind is LegKind.WALK and self.route_id:
            raise PlanError("a walk cannot be on a route")
        object.__setattr__(self, "intermediate", tuple(self.intermediate))

    @property
    def duration(self) -> int:
        """How long the leg takes, in seconds."""
        return self.arrival - self.departure

    @property
    def is_ride(self) -> bool:
        """Whether the passenger is on a vehicle."""
        return self.kind is LegKind.RIDE

    @property
    def is_walk(self) -> bool:
        """Whether the passenger is on foot."""
        return self.kind is LegKind.WALK

    @property
    def stop_count(self) -> int:
        """How many stops the leg passes through, both ends included."""
        return len(self.intermediate) + 2

    def stops(self) -> tuple[str, ...]:
        """Every stop of the leg in order, both ends included."""
        return (self.from_stop,) + self.intermediate + (self.to_stop,)

    def describe(self) -> str:
        """One line: the times, what was used, and where it went."""
        when = "%s-%s" % (format_short(self.departure), format_short(self.arrival))
        if self.is_walk:
            return "%s walk %s to %s" % (when, self.from_stop, self.to_stop)
        target = self.headsign or self.to_stop
        return "%s %s %s to %s" % (when, self.route_id, target, self.to_stop)

    def __str__(self) -> str:
        return self.describe()

    @classmethod
    def walk(cls, from_stop: str, to_stop: str, departure: int, arrival: int) -> "Leg":
        """Build a walking leg."""
        return cls(LegKind.WALK, from_stop, to_stop, departure, arrival)

    @classmethod
    def ride(
        cls,
        from_stop: str,
        to_stop: str,
        departure: int,
        arrival: int,
        route_id: str,
        trip_id: str,
        pattern_id: str = "",
        headsign: str = "",
        intermediate: Sequence[str] = (),
    ) -> "Leg":
        """Build a riding leg."""
        return cls(
            LegKind.RIDE,
            from_stop,
            to_stop,
            departure,
            arrival,
            route_id,
            trip_id,
            pattern_id or None,
            headsign,
            tuple(intermediate),
        )


@dataclass(frozen=True)
class Journey:
    """A sequence of legs that gets a passenger from one stop to another."""

    legs: Tuple[Leg, ...]

    def __post_init__(self) -> None:
        legs = tuple(self.legs)
        if not legs:
            raise PlanError("a journey needs at least one leg")
        for first, second in zip(legs, legs[1:]):
            if first.to_stop != second.from_stop:
                raise PlanError(
                    "a journey jumps from %r to %r" % (first.to_stop, second.from_stop)
                )
            if second.departure < first.arrival:
                raise PlanError(
                    "a journey leaves %r before it gets there" % (second.from_stop,)
                )
        object.__setattr__(self, "legs", legs)

    def __len__(self) -> int:
        return len(self.legs)

    def __iter__(self):
        return iter(self.legs)

    def __getitem__(self, index):
        return self.legs[index]

    @property
    def origin(self) -> str:
        """Where the journey starts."""
        return self.legs[0].from_stop

    @property
    def destination(self) -> str:
        """Where the journey ends."""
        return self.legs[-1].to_stop

    @property
    def departure(self) -> int:
        """When the passenger sets off."""
        return self.legs[0].departure

    @property
    def arrival(self) -> int:
        """When the passenger gets there."""
        return self.legs[-1].arrival

    @property
    def duration(self) -> int:
        """How long the whole journey takes."""
        return self.arrival - self.departure

    @property
    def rides(self) -> tuple[Leg, ...]:
        """The legs spent on a vehicle."""
        return tuple(leg for leg in self.legs if leg.is_ride)

    @property
    def walks(self) -> tuple[Leg, ...]:
        """The legs spent on foot."""
        return tuple(leg for leg in self.legs if leg.is_walk)

    @property
    def transfers(self) -> int:
        """How many times the passenger changes vehicle."""
        return max(0, len(self.rides) - 1)

    @property
    def walk_seconds(self) -> int:
        """How long is spent walking."""
        return sum(leg.duration for leg in self.walks)

    @property
    def ride_seconds(self) -> int:
        """How long is spent aboard."""
        return sum(leg.duration for leg in self.rides)

    @property
    def wait_seconds(self) -> int:
        """How long is spent waiting between legs."""
        return self.duration - self.walk_seconds - self.ride_seconds

    def routes(self) -> tuple[str, ...]:
        """The routes used, in the order they are ridden."""
        return tuple(leg.route_id for leg in self.rides if leg.route_id)

    def stops(self) -> tuple[str, ...]:
        """Every stop the journey touches, in order, without repeats in a row."""
        found = []
        for leg in self.legs:
            for stop_id in leg.stops():
                if not found or found[-1] != stop_id:
                    found.append(stop_id)
        return tuple(found)

    def interchanges(self) -> tuple[str, ...]:
        """The stops where the passenger changes from one vehicle to the next."""
        return tuple(leg.to_stop for leg in self.legs[:-1] if leg.is_ride)

    def dominates(self, other: "Journey") -> bool:
        """Whether this journey is at least as good on both counts and better on one.

        The two counts are when the passenger arrives and how many changes they
        make. A journey that is worse on neither and better on one is the one to
        offer; the other is not worth showing.
        """
        if self.arrival > other.arrival or self.transfers > other.transfers:
            return False
        return self.arrival < other.arrival or self.transfers < other.transfers

    def sort_key(self) -> tuple:
        """The order journeys are offered in: earliest arrival, then fewest changes."""
        return (self.arrival, self.transfers, self.departure, self.routes())

    def describe(self) -> str:
        """One line: when it leaves and arrives, how long, how many changes."""
        return "%s-%s (%s, %d changes)" % (
            format_short(self.departure),
            format_short(self.arrival),
            format_duration(self.duration),
            self.transfers,
        )

    def itinerary(self) -> tuple[str, ...]:
        """One line per leg, the way a printed itinerary reads."""
        return tuple(leg.describe() for leg in self.legs)

    def __str__(self) -> str:
        return self.describe()
