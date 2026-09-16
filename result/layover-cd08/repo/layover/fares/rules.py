"""Fare products and the rules that decide which one a ride is sold under.

A product is a price and what it buys: how many changes it covers and for how
long. A rule says when the product applies, by origin zone, destination zone and
optionally the route. The most specific matching rule wins, and ties are broken
by the cheaper price so a passenger is never quoted the dearer of two fares that
both apply.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from layover.errors import FareError
from layover.money import Money
from layover.times import format_duration

__all__ = ["FareProduct", "FareRule"]


@dataclass(frozen=True)
class FareProduct:
    """A ticket: what it costs and what it covers.

    ``transfers`` is how many changes the ticket allows after the first
    boarding, ``None`` meaning as many as the passenger likes. ``window`` is how
    long it stays valid from the first boarding, ``None`` meaning until the
    journey ends.
    """

    fare_id: str
    price: Money
    transfers: Optional[int] = None
    window: Optional[int] = None
    name: str = ""

    def __post_init__(self) -> None:
        identifier = str(self.fare_id).strip()
        if not identifier:
            raise FareError("a fare product needs an identifier")
        object.__setattr__(self, "fare_id", identifier)
        if not isinstance(self.price, Money):
            object.__setattr__(self, "price", Money(self.price))
        if self.transfers is not None:
            transfers = int(self.transfers)
            if transfers < 0:
                raise FareError("fare %r allows a negative number of changes" % identifier)
            object.__setattr__(self, "transfers", transfers)
        if self.window is not None:
            window = int(self.window)
            if window <= 0:
                raise FareError("fare %r is valid for no time at all" % identifier)
            object.__setattr__(self, "window", window)
        object.__setattr__(self, "name", str(self.name).strip())

    @property
    def unlimited_transfers(self) -> bool:
        """Whether the ticket covers as many changes as the journey needs."""
        return self.transfers is None

    def covers_transfer(self, used: int) -> bool:
        """Whether a change is still covered after ``used`` of them."""
        if used < 0:
            raise FareError("a journey cannot have made %d changes" % used)
        return self.transfers is None or used < self.transfers

    def covers_time(self, elapsed: int) -> bool:
        """Whether the ticket is still valid ``elapsed`` seconds after boarding."""
        return self.window is None or elapsed <= self.window

    def describe(self) -> str:
        """The product written out: price, changes and validity."""
        parts = [str(self.price)]
        if self.transfers is None:
            parts.append("any changes")
        elif self.transfers == 0:
            parts.append("no changes")
        elif self.transfers == 1:
            parts.append("1 change")
        else:
            parts.append("%d changes" % self.transfers)
        if self.window is not None:
            parts.append("within %s" % format_duration(self.window))
        return ", ".join(parts)

    def __str__(self) -> str:
        return "%s (%s)" % (self.name or self.fare_id, self.describe())


@dataclass(frozen=True)
class FareRule:
    """When a product applies: a zone pair, and optionally one route."""

    fare_id: str
    from_zone: Optional[str] = None
    to_zone: Optional[str] = None
    route_id: Optional[str] = None

    def __post_init__(self) -> None:
        identifier = str(self.fare_id).strip()
        if not identifier:
            raise FareError("a fare rule needs a product")
        object.__setattr__(self, "fare_id", identifier)
        for field_name in ("from_zone", "to_zone", "route_id"):
            value = getattr(self, field_name)
            if value is not None:
                cleaned = str(value).strip()
                if not cleaned:
                    raise FareError("fare rule for %r has an empty %s" % (identifier, field_name))
                object.__setattr__(self, field_name, cleaned)

    @property
    def specificity(self) -> int:
        """How many conditions the rule sets, most specific being highest."""
        return sum(1 for value in (self.from_zone, self.to_zone, self.route_id) if value is not None)

    def matches(self, from_zone: str, to_zone: str, route_id: str) -> bool:
        """Whether the rule applies to a ride between two zones on a route."""
        if self.from_zone is not None and self.from_zone != from_zone:
            return False
        if self.to_zone is not None and self.to_zone != to_zone:
            return False
        if self.route_id is not None and self.route_id != route_id:
            return False
        return True

    def __str__(self) -> str:
        parts = []
        if self.from_zone is not None or self.to_zone is not None:
            parts.append("%s to %s" % (self.from_zone or "any", self.to_zone or "any"))
        if self.route_id is not None:
            parts.append("on %s" % self.route_id)
        return "%s: %s" % (self.fare_id, ", ".join(parts) if parts else "anywhere")
