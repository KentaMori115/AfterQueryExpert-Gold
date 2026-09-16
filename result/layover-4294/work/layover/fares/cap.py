"""Fare caps: the most a passenger is charged over a day or over a week.

A cap is not a product. Nothing is ever sold under one: tickets are bought the
way :mod:`layover.fares.price` buys them, and a cap only says how much of what
they cost is actually charged. That keeps the two apart, so a feed can add a
cap without touching a single fare rule.

A cap may name a zone, a route or both, in which case it only limits travel
that stays inside them, and the same selection the fare rules use settles which
of several caps applies: the most specific first, then the cheaper, then the
identifier. A ceiling nobody can reach is therefore never picked over one a
passenger is actually travelling under.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

from layover.errors import FareError
from layover.money import Money

__all__ = ["CapTotal", "FareCap", "PERIODS", "period_start"]

PERIODS = ("day", "week")


def period_start(period: str, day: date) -> date:
    """The first service day of the period a day belongs to.

    A day period starts on the day itself. A week period starts on the Monday
    of that week and runs to the Sunday, which is the same week the calendars
    in :mod:`layover.dates` are written against.
    """
    if period == "day":
        return day
    if period == "week":
        return day - timedelta(days=day.weekday())
    raise FareError("a cap period is one of %s, got %r" % (", ".join(PERIODS), period))


@dataclass(frozen=True)
class FareCap:
    """A ceiling on what one passenger pays inside one period.

    ``period`` is ``"day"`` or ``"week"``. ``zone`` limits the cap to travel
    that never leaves one fare zone and ``route_id`` to travel that never
    leaves one route; a cap that sets neither limits everything.
    """

    cap_id: str
    price: Money
    period: str
    zone: Optional[str] = None
    route_id: Optional[str] = None

    def __post_init__(self) -> None:
        identifier = str(self.cap_id).strip()
        if not identifier:
            raise FareError("a fare cap needs an identifier")
        object.__setattr__(self, "cap_id", identifier)
        if not isinstance(self.price, Money):
            object.__setattr__(self, "price", Money(self.price))
        if self.price.cents < 0:
            raise FareError("cap %r caps travel at less than nothing" % identifier)
        period = str(self.period).strip().lower()
        if period not in PERIODS:
            raise FareError(
                "cap %r has period %r, which is not one of %s"
                % (identifier, self.period, ", ".join(PERIODS))
            )
        object.__setattr__(self, "period", period)
        for field_name in ("zone", "route_id"):
            value = getattr(self, field_name)
            if value is None:
                continue
            cleaned = str(value).strip()
            if not cleaned:
                raise FareError("cap %r has an empty %s" % (identifier, field_name))
            object.__setattr__(self, field_name, cleaned)

    @property
    def specificity(self) -> int:
        """How many conditions the cap sets, most specific being highest."""
        return sum(1 for value in (self.zone, self.route_id) if value is not None)

    @property
    def everywhere(self) -> bool:
        """Whether the cap limits travel anywhere rather than one corner of it."""
        return self.zone is None and self.route_id is None

    def covers(self, zones: Iterable[str], routes: Iterable[str] = ()) -> bool:
        """Whether the cap limits a ticket that touched these zones and routes."""
        if self.zone is not None:
            touched = set(zones)
            if not touched or touched != {self.zone}:
                return False
        if self.route_id is not None:
            ridden = set(routes)
            if not ridden or ridden != {self.route_id}:
                return False
        return True

    def starts_on(self, day: date) -> date:
        """The first day of the period this cap counts ``day`` against."""
        return period_start(self.period, day)

    def describe(self) -> str:
        """The cap written out: price, period and where it applies."""
        parts = []
        if self.zone is not None:
            parts.append("inside %s" % self.zone)
        if self.route_id is not None:
            parts.append("on %s" % self.route_id)
        where = ", ".join(parts) if parts else "anywhere"
        return "%s a %s, %s" % (self.price, self.period, where)

    def __str__(self) -> str:
        return "%s (%s)" % (self.cap_id, self.describe())


@dataclass(frozen=True)
class CapTotal:
    """How much one cap collected over one of its periods.

    ``starts_on`` is the first service day of that period, so a weekly cap
    reached twice in a fortnight shows up as two of these rather than one.
    """

    cap_id: str
    period: str
    starts_on: date
    charged: Money
    limit: Money

    @property
    def remaining(self) -> Money:
        """How much of the cap a passenger has still to pay before it bites."""
        return self.limit - self.charged

    @property
    def reached(self) -> bool:
        """Whether the passenger has paid the whole cap, so the rest is free."""
        return not self.remaining.cents > 0

    def describe(self) -> str:
        """One line: the cap, the period it covers and what it took."""
        return "%s from %s: %s of %s" % (
            self.cap_id,
            self.starts_on.isoformat(),
            self.charged,
            self.limit,
        )

    def __str__(self) -> str:
        return self.describe()
