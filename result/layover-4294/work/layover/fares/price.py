"""Pricing a journey by walking its rides in order.

The first ride buys a ticket, and the product is the one its own zones and route
select. Each ride after it is covered by that ticket while the product allows
another change and the validity window has not run out; otherwise a new ticket
is bought, selected afresh from that ride, and the count starts again. Nothing here knows
what a journey is: a ride is anything with a route, two stops and two times, so
the plan layer and a hand written list are priced by the same code.

What a ticket costs is not always what a passenger is charged: a ride carries
the service day it ran on, and :mod:`layover.fares.travel` reads that day to
hold a run of travel under the caps a feed declares. Pricing itself stays
day blind, because a ticket is bought before anything knows how much of the
week has already been paid for.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import List, Optional, Sequence

from layover.errors import FareError
from layover.fares.rules import FareProduct
from layover.fares.table import FareTable
from layover.fares.zones import ZoneMap
from layover.money import Money, total_of
from layover.times import format_clock

__all__ = ["FarePrice", "Ride", "TicketPurchase", "price_rides"]


@dataclass(frozen=True)
class Ride:
    """One boarding: a route, where the passenger got on and off, and when.

    ``day`` is the service day the ride belongs to, which is what a cap counts
    against. Pricing one journey never needs it, so it stays optional and the
    times keep their meaning: seconds on that service day, past 24 hours for a
    ride that runs into the next morning.
    """

    route_id: str
    from_stop: str
    to_stop: str
    board_time: int
    alight_time: int
    day: Optional[date] = None

    def __post_init__(self) -> None:
        if self.alight_time < self.board_time:
            raise FareError(
                "a ride on %r gets off before it gets on" % (self.route_id,)
            )

    @property
    def duration(self) -> int:
        """How long the passenger is aboard."""
        return self.alight_time - self.board_time

    def service_day(self) -> date:
        """The service day the ride ran on, raising if it does not say."""
        if self.day is None:
            raise FareError("ride %s does not say which service day it ran on" % self)
        return self.day

    def stops(self) -> tuple[str, str]:
        """Where the passenger got on and where they got off."""
        return (self.from_stop, self.to_stop)

    def __str__(self) -> str:
        return "%s %s to %s at %s" % (
            self.route_id,
            self.from_stop,
            self.to_stop,
            format_clock(self.board_time),
        )


@dataclass(frozen=True)
class TicketPurchase:
    """One ticket bought, and the rides it covered."""

    product: FareProduct
    rides: tuple[Ride, ...]
    bought_at: int

    @property
    def price(self) -> Money:
        """What the ticket cost."""
        return self.product.price

    @property
    def transfers(self) -> int:
        """How many changes the ticket was used for."""
        return len(self.rides) - 1

    def __str__(self) -> str:
        return "%s at %s for %d rides" % (
            self.product.fare_id,
            format_clock(self.bought_at),
            len(self.rides),
        )


@dataclass(frozen=True)
class FarePrice:
    """What a journey costs, and which tickets make it up."""

    total: Money
    tickets: tuple[TicketPurchase, ...]

    @property
    def ticket_count(self) -> int:
        """How many tickets the passenger had to buy."""
        return len(self.tickets)

    @property
    def rides(self) -> tuple[Ride, ...]:
        """Every ride priced, in order."""
        return tuple(ride for ticket in self.tickets for ride in ticket.rides)

    def describe(self) -> str:
        """One line: the total and how many tickets it took."""
        if self.ticket_count == 1:
            return "%s on one ticket" % self.total
        return "%s on %d tickets" % (self.total, self.ticket_count)

    def __str__(self) -> str:
        return self.describe()


def price_rides(
    rides: Sequence[Ride],
    table: FareTable,
    zones: ZoneMap,
) -> FarePrice:
    """Work out what a sequence of rides costs under a fare table."""
    if not rides:
        return FarePrice(Money.zero(table.currency), ())
    if table.is_empty:
        raise FareError("the fare table has no rules to price a journey with")
    tickets: List[TicketPurchase] = []
    current: Optional[FareProduct] = None
    covered: List[Ride] = []
    bought_at = rides[0].board_time
    for ride in rides:
        product = _product_for(ride, table, zones)
        if current is not None and _still_covered(current, covered, ride, bought_at):
            covered.append(ride)
            continue
        if current is not None:
            tickets.append(TicketPurchase(current, tuple(covered), bought_at))
        current = product
        covered = [ride]
        bought_at = ride.board_time
    if current is not None:
        tickets.append(TicketPurchase(current, tuple(covered), bought_at))
    return FarePrice(total_of([ticket.price for ticket in tickets], table.currency), tuple(tickets))


def _product_for(ride: Ride, table: FareTable, zones: ZoneMap) -> FareProduct:
    from_zone = zones.zone_of(ride.from_stop)
    to_zone = zones.zone_of(ride.to_stop)
    product = table.match(from_zone, to_zone, ride.route_id)
    if product is None:
        raise FareError(
            "no fare covers %s to %s on route %r" % (from_zone, to_zone, ride.route_id)
        )
    return product


def _still_covered(
    product: FareProduct,
    covered: Sequence[Ride],
    ride: Ride,
    bought_at: int,
) -> bool:
    changes_made = len(covered) - 1
    if not product.covers_transfer(changes_made):
        return False
    return product.covers_time(ride.board_time - bought_at)
